import { repository } from "@/lib/data";
import { subscribe } from "@/lib/events";
import { errorText, log } from "@/lib/log";
import { quoteUntrusted } from "@/lib/messaging/templates";
import type { DomainEventRecord, MissedOpportunityType, TenantSummary } from "@/lib/types";
import { formatMoney, humanize } from "@/lib/utils";
import { agentsMode } from "./policy";
import { startAgentRun } from "./runtime";

/**
 * What wakes an agent. Customer Relations starts on each missed opportunity
 * about a lead and on each reply from a contact with an open lead. These run
 * after the automatic reply and the call-first chase, never instead of them:
 * if an agent is off or fails, the business gets exactly what it got before.
 * A trigger never throws into the event that fired it.
 */

const ROLE = "customer_relations";

/** The missed opportunities a person's call or message can recover. Reviews, comments and lapsed customers wait for their own agents. */
const LEAD_TYPES: ReadonlySet<MissedOpportunityType> = new Set<MissedOpportunityType>(["UNANSWERED_ENQUIRY", "MISSED_CALL", "ABANDONED_FORM", "NOT_BOOKED", "NO_SHOW", "QUIET_QUOTE"]);

const UNFINISHED = ["QUEUED", "RUNNING", "WAITING", "PAUSED"] as const;

let registered = false;

export function registerAgentTriggers() {
  if (registered) return;
  registered = true;
  subscribe("missed_opportunity.detected", (e) => safely(e, onMissedOpportunity));
  subscribe("message.received", (e) => safely(e, onReply));
}

async function safely(event: DomainEventRecord, handle: (tenant: TenantSummary, event: DomainEventRecord) => Promise<void>) {
  if (agentsMode() === "off") return;
  try {
    const tenant = await repository.findTenantById(event.tenantId);
    if (tenant) await handle(tenant, event);
  } catch (error) {
    log("error", "agent.trigger_failed", { tenantId: event.tenantId, event: event.type, error: errorText(error) });
  }
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

export async function onMissedOpportunity(tenant: TenantSummary, event: DomainEventRecord) {
  const id = str(event.payload.missedOpportunityId);
  const item = id ? await repository.findMissedOpportunityById(tenant.id, id) : null;
  if (!item?.leadId || !LEAD_TYPES.has(item.type)) return;
  const value = item.estimatedValueCents > 0 ? ` It is estimated to be worth ${formatMoney(item.estimatedValueCents, tenant.currency, tenant.locale, { whole: true })}.` : "";
  const task = [
    `A missed opportunity was just raised: ${humanize(item.type).toLowerCase()}. The detector's summary: <untrusted>${quoteUntrusted(item.summary, 400)}</untrusted>${value}`,
    `Missed opportunity id: ${item.id}. Lead id: ${item.leadId}.`,
    "Get this person the call they are waiting for: write a call brief, remind the team if nobody has called, and draft a message only if it would help. Finish with a short summary for the team.",
  ].join("\n\n");
  await start(tenant, { trigger: "missed_opportunity", dedupeKey: `mo:${item.id}`, task, leadId: item.leadId, contactId: item.contactId, missedOpportunityId: item.id });
}

export async function onReply(tenant: TenantSummary, event: DomainEventRecord) {
  const contactId = str(event.payload.contactId);
  const messageId = str(event.payload.messageId);
  if (!contactId || !messageId) return;
  const lead = await repository.findLatestOpenLeadForContact(tenant.id, contactId);
  if (!lead) return;
  // One run per lead at a time: a reply while one is working is in the conversation it reads.
  const working = await repository.listAgentRuns(tenant.id, { roleKey: ROLE, status: [...UNFINISHED], limit: 50 });
  if (working.some((r) => r.leadId === lead.id)) return;
  const said = str(event.payload.body);
  const task = [
    `Lead ${lead.id} just replied${str(event.payload.channel) ? ` by ${humanize(String(event.payload.channel)).toLowerCase()}` : ""}${said ? `: <untrusted>${quoteUntrusted(said, 500)}</untrusted>` : "."}`,
    "Read the conversation, update the call brief if anything changed, and draft a reply only if one is needed before someone calls. Finish with a short summary for the team.",
  ].join("\n\n");
  await start(tenant, { trigger: "contact_reply", dedupeKey: `reply:${messageId}`, task, leadId: lead.id, contactId, missedOpportunityId: null });
}

async function start(tenant: TenantSummary, input: { trigger: string; dedupeKey: string; task: string; leadId: string; contactId: string | null; missedOpportunityId: string | null }) {
  const out = await startAgentRun({ tenant, roleKey: ROLE, ...input });
  // Most refusals are the agent being off for this workspace, which is the normal state until an operator turns it on.
  if (!out.ok && !/not switched on/.test(out.reason)) log("warn", "agent.trigger_refused", { tenantId: tenant.id, trigger: input.trigger, reason: out.reason });
}
