import { repository } from "@/lib/data";
import { emit, subscribe } from "@/lib/events";
import { leadDisplayName } from "@/lib/leads";
import type { StageAdvanceTrigger } from "@/lib/types";

/**
 * Stages move on their own. The spec: "Stages move automatically on bookings
 * and payments." A booking is handled where it is created; this covers the
 * rest. A completed appointment advances the lead to the first stage that
 * waits for one; a payment from the contact advances their open lead to the
 * stage that waits for money. A stage marked "won" or "lost" also settles the
 * lead's status, and a win is announced so review requests can follow.
 */
export async function advanceLeadOn(tenantId: string, leadId: string, trigger: StageAdvanceTrigger, because: string, typeKey: string): Promise<boolean> {
  const result = await repository.advanceLead(tenantId, leadId, trigger, new Date());
  if (!result?.moved) return false;
  const { lead, stageName } = result;
  await repository.recordAutomationRun(tenantId, {
    typeKey,
    outcome: "COMPLETED",
    summary: `${leadDisplayName(lead)} moved to "${stageName}" ${because}.`,
    leadId: lead.id,
    contactId: lead.contactId,
  });
  await emit(tenantId, "lead.stage_changed", { leadId: lead.id, contactId: lead.contactId, stageId: lead.stageId, stageName, trigger });
  if (lead.status === "WON") await emit(tenantId, "lead.won", { leadId: lead.id, contactId: lead.contactId, stageName });
  return true;
}

let registered = false;

export function registerPipelineAdvancement() {
  if (registered) return;
  registered = true;

  subscribe("booking.completed", async (event) => {
    const leadId = typeof event.payload.leadId === "string" ? event.payload.leadId : null;
    // A booking that merely passed its time is not known to have happened; only one a person marked attended moves the pipeline.
    if (!leadId || event.payload.auto === true) return;
    await advanceLeadOn(event.tenantId, leadId, "BOOKING_COMPLETED", "after their appointment", "booking_lifecycle");
  });

  subscribe("invoice.paid", async (event) => {
    const contactId = typeof event.payload.contactId === "string" ? event.payload.contactId : null;
    if (!contactId) return;
    const lead = await repository.findLatestOpenLeadForContact(event.tenantId, contactId);
    if (!lead) return;
    await advanceLeadOn(event.tenantId, lead.id, "PAYMENT_RECEIVED", "after their payment", "finance_sync");
  });
}

/** Exposed for tests. */
export function _resetPipelineAdvancement() {
  registered = false;
}
