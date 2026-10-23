import { repository } from "@/lib/data";
import { emit } from "@/lib/events";
import { leadDisplayName } from "@/lib/leads";
import type { MissedOpportunityType, TenantSummary } from "@/lib/types";

export interface DetectionResult {
  tenantId: string;
  detected: { type: MissedOpportunityType; leadId: string }[];
}

/** Estimated value for a missed-opportunity type from tenant config, falling back to the lead's own value. */
export function opportunityValue(tenant: TenantSummary, type: MissedOpportunityType, leadValueCents = 0): number {
  return tenant.opportunityValues[type] ?? leadValueCents;
}

/**
 * The "sla_watch" automation: turns leads that missed the response or booking
 * window into missed opportunities and raises each for an operator. Safe to
 * run as often as you like; one open item per lead and type.
 */
export async function detectForTenant(tenant: TenantSummary, now = new Date()): Promise<DetectionResult> {
  const { respond, book } = await repository.listLeadsPastSla(tenant.id, now);
  const detected: DetectionResult["detected"] = [];

  const raise = async (type: MissedOpportunityType, leadId: string, contactId: string | null, summary: string, suggestedAction: string, leadValueCents: number) => {
    const { record, created } = await repository.upsertMissedOpportunity(tenant.id, {
      type,
      leadId,
      contactId,
      estimatedValueCents: opportunityValue(tenant, type, leadValueCents),
      summary,
      dedupeKey: `${type}:${leadId}`,
    });
    if (!created) return;
    await repository.resolveMissedOpportunity(tenant.id, record.id, "ESCALATED");
    await repository.createException(tenant.id, { reason: summary, suggestedAction, confidence: 0.5, leadId, contactId, missedOpportunityId: record.id });
    await repository.recordAutomationRun(tenant.id, { typeKey: "sla_watch", outcome: "ESCALATED", summary: `${summary} Raised for an operator.`, leadId, contactId, missedOpportunityId: record.id });
    await emit(tenant.id, "missed_opportunity.detected", { type, leadId, missedOpportunityId: record.id, estimatedValueCents: record.estimatedValueCents });
    detected.push({ type, leadId });
  };

  for (const lead of respond) {
    const name = leadDisplayName(lead);
    await raise(
      "UNANSWERED_ENQUIRY",
      lead.id,
      lead.contactId,
      `${name} has waited more than ${tenant.sla.firstResponseMinutes} minutes without a reply.`,
      "Reply now, then confirm the automated acknowledgement is working.",
      lead.valueCents,
    );
  }
  for (const lead of book) {
    const name = leadDisplayName(lead);
    await raise(
      "NOT_BOOKED",
      lead.id,
      lead.contactId,
      `${name} was acknowledged but nothing was booked within ${tenant.sla.bookingWindowHours} hours.`,
      "Call them directly and offer a time this week.",
      lead.valueCents,
    );
  }
  return { tenantId: tenant.id, detected };
}
