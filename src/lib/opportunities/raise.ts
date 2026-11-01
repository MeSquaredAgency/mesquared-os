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

/**
 * The client person a tenant's escalation rules name for this type: a rule for
 * the exact type beats a catch-all "*". Only a current member of the workspace
 * can be told; a rule pointing at someone who has left (or at an id from
 * elsewhere) is ignored and logged, so lead details never leave the tenant.
 */
export async function escalateeFor(tenant: TenantSummary, type: MissedOpportunityType): Promise<{ userId: string; email: string; name: string | null } | null> {
  const rule = tenant.escalationRules.find((r) => r.when === type) ?? tenant.escalationRules.find((r) => r.when === "*");
  if (!rule?.notifyUserId) return null;
  const member = (await repository.listTenantPeople(tenant.id)).find((p) => p.via === "member" && p.userId === rule.notifyUserId);
  if (!member) {
    console.warn(`[opportunities] escalation rule "${rule.when}" for ${tenant.slug} names a user who is not a member of the workspace; ignored`);
    return null;
  }
  return { userId: member.userId, email: member.email, name: member.name };
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

  const escalatee = await escalateeFor(tenant, input.type);
  const escalatedToUserId = escalatee?.userId ?? null;
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
    summary: `${input.summary} ${escalatee ? `We've passed this to ${escalatee.name ?? "your team"}.` : "We've flagged this for a person to pick up."}`,
    leadId: input.leadId,
    contactId: input.contactId,
    missedOpportunityId: record.id,
  });

  if (escalatee) {
    const mail = templates.escalationEmail({ tenant, summary: input.summary, suggestedAction: input.suggestedAction, portalUrl: `${(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/app/${tenant.slug}/opportunities` });
    await sendMessage({ tenant, contactId: null, channel: "EMAIL", to: escalatee.email, body: mail.body, subject: mail.subject, transactional: true });
  }

  await emit(tenant.id, "missed_opportunity.detected", { type: input.type, leadId: input.leadId, contactId: input.contactId, missedOpportunityId: record.id, exceptionId: exception.id, estimatedValueCents: record.estimatedValueCents });
  return record;
}
