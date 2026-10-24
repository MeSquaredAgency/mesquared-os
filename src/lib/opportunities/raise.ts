import { repository } from "@/lib/data";
import { emit } from "@/lib/events";
import { sendMessage, templates } from "@/lib/messaging";
import type { MissedOpportunityType, TenantSummary } from "@/lib/types";

export interface RaiseInput {
  type: MissedOpportunityType;
  leadId: string | null;
  contactId: string | null;
  /** What the dedupe key is built on: a lead id, a contact id, a review id… */
  subjectId: string;
  summary: string;
  suggestedAction: string;
  /** Fallback when the tenant has no configured value for this type. */
  fallbackValueCents?: number;
  confidence?: number;
}

/** Estimated value for a missed-opportunity type from tenant config, falling back to a supplied value. */
export function opportunityValue(tenant: TenantSummary, type: MissedOpportunityType, fallbackCents = 0): number {
  return tenant.opportunityValues[type] ?? fallbackCents;
}

/**
 * Records a missed opportunity once, raises it for an operator (or the client
 * person the tenant's escalation rules name), logs the run and emits the
 * event. Returns null when an open item already existed for the subject.
 */
export async function raiseMissedOpportunity(tenant: TenantSummary, input: RaiseInput) {
  const { record, created } = await repository.upsertMissedOpportunity(tenant.id, {
    type: input.type,
    leadId: input.leadId,
    contactId: input.contactId,
    estimatedValueCents: opportunityValue(tenant, input.type, input.fallbackValueCents),
    summary: input.summary,
    dedupeKey: `${input.type}:${input.subjectId}`,
  });
  if (!created) return null;

  const rule = tenant.escalationRules.find((r) => r.when === input.type || r.when === "*");
  const escalatedToUserId = rule?.notifyUserId ?? null;

  await repository.resolveMissedOpportunity(tenant.id, record.id, "ESCALATED");
  const exception = await repository.createException(tenant.id, {
    reason: input.summary,
    suggestedAction: input.suggestedAction,
    confidence: input.confidence ?? 0.5,
    leadId: input.leadId,
    contactId: input.contactId,
    missedOpportunityId: record.id,
    escalatedToUserId,
  });
  await repository.recordAutomationRun(tenant.id, {
    typeKey: "sla_watch",
    outcome: "ESCALATED",
    summary: `${input.summary} ${escalatedToUserId ? "Escalated to your team." : "Raised for an operator."}`,
    leadId: input.leadId,
    contactId: input.contactId,
    missedOpportunityId: record.id,
  });

  if (escalatedToUserId) {
    const user = await repository.findUserById(escalatedToUserId);
    if (user) {
      const mail = templates.escalationEmail({ tenant, summary: input.summary, suggestedAction: input.suggestedAction, portalUrl: `${(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/app/${tenant.slug}/opportunities` });
      await sendMessage({ tenant, contactId: null, channel: "EMAIL", to: user.email, body: mail.body, subject: mail.subject, transactional: true });
    }
  }

  await emit(tenant.id, "missed_opportunity.detected", { type: input.type, leadId: input.leadId, contactId: input.contactId, missedOpportunityId: record.id, exceptionId: exception.id, estimatedValueCents: record.estimatedValueCents });
  return record;
}
