import { repository } from "@/lib/data";
import { emit, subscribe } from "@/lib/events";
import { MISSED_OPPORTUNITY_LABEL } from "@/lib/copy";
import type { MissedOpportunityRecord, MissedOpportunityType } from "@/lib/types";

/**
 * Closes the loop on missed opportunities. The detectors say when money is
 * leaking; this says when it came back. A person who abandoned a form and
 * then enquires, a missed caller who texts back, a quiet quote that gets
 * paid, a lapsed customer who books: each open item for them is marked
 * RECOVERED with its value, so "Recovered this month" is earned, not guessed.
 *
 * Everything here runs off events, so every path that brings someone back
 * (webhooks, intake, finance sync) counts, without each of them knowing.
 */

interface Recovery {
  leadId?: string | null;
  contactId?: string | null;
  types: MissedOpportunityType[];
  /** What brought them back, finishing the sentence "…, so the X is recovered." */
  because: string;
  /** Actual money, when the recovery is a payment; otherwise the estimate stands. */
  valueCents?: number | null;
}

const ON_ENQUIRY: MissedOpportunityType[] = ["ABANDONED_FORM", "MISSED_CALL", "LAPSED_CUSTOMER"];
const ON_REPLY: MissedOpportunityType[] = ["MISSED_CALL", "LAPSED_CUSTOMER"];
const ON_BOOKING_LEAD: MissedOpportunityType[] = ["NOT_BOOKED", "NO_SHOW", "QUIET_QUOTE", "UNANSWERED_ENQUIRY"];
const ON_BOOKING_CONTACT: MissedOpportunityType[] = ["MISSED_CALL", "LAPSED_CUSTOMER", "ABANDONED_FORM"];
const ON_PAYMENT: MissedOpportunityType[] = ["QUIET_QUOTE", "LAPSED_CUSTOMER", "NOT_BOOKED"];

/** Marks every open item matching the recovery as RECOVERED. Returns what was closed. */
export async function recoverOpportunities(tenantId: string, recovery: Recovery): Promise<MissedOpportunityRecord[]> {
  const open = await repository.listOpenMissedOpportunitiesFor(tenantId, { leadId: recovery.leadId, contactId: recovery.contactId, types: recovery.types });
  const recovered: MissedOpportunityRecord[] = [];
  for (const item of open) {
    const value = recovery.valueCents && recovery.valueCents > 0 ? recovery.valueCents : item.estimatedValueCents;
    const done = await repository.resolveMissedOpportunity(tenantId, item.id, "RECOVERED", value);
    if (!done) continue;
    recovered.push(done);
    await repository.recordAutomationRun(tenantId, {
      typeKey: "sla_watch",
      outcome: "COMPLETED",
      summary: `${recovery.because}, so the ${(MISSED_OPPORTUNITY_LABEL[item.type] ?? item.type).toLowerCase()} we flagged is recovered.`,
      leadId: item.leadId,
      contactId: item.contactId,
      missedOpportunityId: item.id,
    });
    await emit(tenantId, "missed_opportunity.recovered", { missedOpportunityId: item.id, type: item.type, recoveredValueCents: value, leadId: item.leadId, contactId: item.contactId });
  }
  return recovered;
}

let registered = false;

export function registerReconciler() {
  if (registered) return;
  registered = true;

  // A new enquiry from someone we had already flagged.
  subscribe("intake.received", async (event) => {
    const contactId = typeof event.payload.contactId === "string" ? event.payload.contactId : null;
    if (!contactId) return;
    await recoverOpportunities(event.tenantId, { contactId, types: ON_ENQUIRY, because: "They got in touch again" });
  });

  // They replied to the text or message we sent them.
  subscribe("message.received", async (event) => {
    const contactId = typeof event.payload.contactId === "string" ? event.payload.contactId : null;
    if (!contactId) return;
    await recoverOpportunities(event.tenantId, { contactId, types: ON_REPLY, because: "They replied" });
  });

  // A booking settles everything about the lead, and anything open about the person behind it.
  subscribe("booking.created", async (event) => {
    const leadId = typeof event.payload.leadId === "string" ? event.payload.leadId : null;
    if (!leadId) return;
    const lead = await repository.findLeadById(event.tenantId, leadId);
    await recoverOpportunities(event.tenantId, { leadId, types: ON_BOOKING_LEAD, because: "They booked a time" });
    if (lead?.contactId) await recoverOpportunities(event.tenantId, { contactId: lead.contactId, types: ON_BOOKING_CONTACT, because: "They booked a time" });
  });

  // Money in the door: the recovered value is the real amount, not the estimate.
  subscribe("invoice.paid", async (event) => {
    const contactId = typeof event.payload.contactId === "string" ? event.payload.contactId : null;
    if (!contactId) return;
    const amountCents = typeof event.payload.amountCents === "number" ? event.payload.amountCents : null;
    await recoverOpportunities(event.tenantId, { contactId, types: ON_PAYMENT, because: "They paid", valueCents: amountCents });
  });
}

/** Exposed for tests. */
export function _resetReconciler() {
  registered = false;
}
