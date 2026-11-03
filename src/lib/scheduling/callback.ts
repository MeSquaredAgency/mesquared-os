import { repository } from "@/lib/data";
import { emit } from "@/lib/events";
import { leadDisplayName } from "@/lib/leads";
import type { LeadRecord, TenantSummary } from "@/lib/types";

/** The time the lead typed, safe to quote: no angle brackets, at most 120 characters. */
export const cleanWhen = (raw: string | null | undefined): string | null => {
  const when = (raw ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
  return when || null;
};

/**
 * A lead has asked to be called back, naming a time or not. One open request
 * per lead: a resubmitted form or a reposted link must not fill the queue.
 *
 * The lead counts as dealt with for now. The response clock settles, an open
 * unanswered-enquiry item closes as recovered, and the call-first chase
 * stands down, because chasing "nobody has called" at someone who asked for
 * tomorrow afternoon is wrong. The queue item is the reminder to call them
 * at the time they gave. With `notify` (the default) the people who should
 * make the call are told by text and email.
 */
export async function recordCallbackRequest(tenant: TenantSummary, lead: LeadRecord, rawWhen: string | null | undefined, opts: { notify?: boolean; now?: Date } = {}): Promise<"recorded" | "already_asked"> {
  const when = cleanWhen(rawWhen);
  const open = await repository.listExceptions([tenant.id], { status: ["OPEN", "IN_PROGRESS"], limit: 200 });
  if (open.some((e) => e.leadId === lead.id && /called back/.test(e.reason))) return "already_asked";
  const now = opts.now ?? new Date();
  const name = leadDisplayName(lead);
  await repository.touchLead(tenant.id, lead.id, now);
  await repository.settleLeadSla(tenant.id, lead.id, now);
  await repository.resolveMissedOpportunityByKey(tenant.id, `UNANSWERED_ENQUIRY:${lead.id}`, "RECOVERED");
  await repository.recordAutomationRun(tenant.id, { typeKey: "booking_lifecycle", outcome: "COMPLETED", summary: `${name} asked for a call back${when ? ` (${when})` : ""}.`, leadId: lead.id, contactId: lead.contactId });
  await repository.createException(tenant.id, { reason: `${name} asked to be called back${when ? `: "${when}"` : ""}.`, suggestedAction: when ? "Call them at the time they suggested." : "Call them; they did not say when, so sooner is better.", confidence: 0.9, leadId: lead.id, contactId: lead.contactId });
  if (opts.notify !== false) await emit(tenant.id, "booking.callback_requested", { leadId: lead.id, when });
  return "recorded";
}
