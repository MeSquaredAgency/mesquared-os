import { repository } from "@/lib/data";
import { emit } from "@/lib/events";
import { leadDisplayName } from "@/lib/leads";
import { sendMessage, templates, textableNumber } from "@/lib/messaging";
import type { LeadRecord, TenantSummary } from "@/lib/types";

/**
 * Call-first workspaces promise every green lead a call from the team. The
 * automated reply is not the response, so when the response window passes
 * with nobody having called, the SLA watch raises the unanswered enquiry as
 * usual and this module chases the people who should be calling: first the
 * assigned person (or everyone with lead alerts when nobody is assigned),
 * then, a little later, everyone with lead alerts. A person marking the lead
 * as called, a booking, or an operator settling the item stops the chase.
 */

/** How long after the first chase the second one goes out: twice the response window, at least ten minutes. */
export function chaseDelayMs(tenant: Pick<TenantSummary, "sla">): number {
  return Math.max(10, 2 * tenant.sla.firstResponseMinutes) * 60_000;
}

const settled = (lead: LeadRecord) => lead.firstResponseAt !== null || lead.status === "BOOKED" || lead.status === "WON" || lead.status === "LOST" || lead.status === "ARCHIVED";

export async function chaseUncalledLead(tenant: TenantSummary, stale: LeadRecord, opts: { again: boolean; now?: Date }): Promise<"sent" | "skipped" | "settled" | "nobody"> {
  const now = opts.now ?? new Date();
  // Re-read: the person may have called since the chase was queued.
  const lead = (await repository.findLeadById(tenant.id, stale.id)) ?? stale;
  if (settled(lead)) return "settled";
  const name = leadDisplayName(lead);
  const minutes = Math.max(1, Math.round((now.getTime() - lead.createdAt.getTime()) / 60_000));

  const everyone = await repository.listAlertRecipients(tenant.id);
  const own = !opts.again && lead.assigneeId ? everyone.filter((r) => r.userId === lead.assigneeId) : [];
  const recipients = own.length ? own : everyone;
  if (recipients.length === 0) {
    await repository.recordAutomationRun(tenant.id, { typeKey: "sla_watch", outcome: "ESCALATED", summary: `${name} is waiting for the call they were promised (${minutes} min), but nobody at ${tenant.name} holds lead alerts yet.`, leadId: lead.id, contactId: lead.contactId });
    return "nobody";
  }
  const phones = new Map((await repository.listTenantPeople(tenant.id)).filter((p) => p.via === "member").map((p) => [p.userId, textableNumber(tenant, p.phone)] as const).filter((e): e is readonly [string, string] => e[1] !== null));
  const portalUrl = `${(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/app/${tenant.slug}/leads`;
  const text = templates.callOverdueSms({ tenant, leadName: name, minutes, phone: lead.phone, again: opts.again });
  const mail = templates.callOverdueEmail({ tenant, leadName: name, minutes, phone: lead.phone, email: lead.email, portalUrl, again: opts.again });
  const who = recipients.length === 1 ? (recipients[0].name ?? recipients[0].email) : `${recipients.length} people`;
  const run = await repository.recordAutomationRun(tenant.id, { typeKey: "sla_watch", outcome: "SENT", summary: `${opts.again ? "Chased" : "Reminded"} ${who} to call ${name}: ${minutes} min and nobody has yet.`, leadId: lead.id, contactId: lead.contactId, details: { recipients: recipients.map((r) => r.userId), again: opts.again } });

  let reached = 0;
  for (const r of recipients) {
    const phone = phones.get(r.userId);
    if (phone) {
      const buzz = await sendMessage({ tenant, contactId: null, channel: "SMS", to: phone, body: text, automationRunId: run.id, transactional: true });
      if (buzz.ok) reached++;
      else if (!buzz.simulated) console.error(`[call-first] text to ${phone.slice(0, 4)}… for ${tenant.slug} failed: ${buzz.error}`);
    }
    const sent = await sendMessage({ tenant, contactId: null, channel: "EMAIL", to: r.email, body: mail.body, subject: mail.subject, automationRunId: run.id, transactional: true });
    if (sent.ok) reached++;
    else if (!sent.simulated) console.error(`[call-first] email to ${r.email.slice(0, 3)}… for ${tenant.slug} failed: ${sent.error}`);
  }
  if (reached === 0) await repository.updateAutomationRun(tenant.id, run.id, { outcome: "SKIPPED", summary: `${name} is waiting for the call they were promised (${minutes} min); nobody could be told because messaging isn't connected for ${tenant.name} yet.` });

  // The second chase, unless this was it. Idempotent per lead; a settled lead makes it a no-op when it runs.
  if (!opts.again) await repository.scheduleAction(tenant.id, { typeKey: "sla_watch", action: "chase_call", runAt: new Date(now.getTime() + chaseDelayMs(tenant)), payload: { leadId: lead.id }, dedupeKey: `sla_watch:chase_call:${lead.id}` });
  await emit(tenant.id, "lead.call_overdue", { leadId: lead.id, minutes, again: opts.again, recipients: recipients.map((r) => r.userId) }, run.id);
  return reached > 0 ? "sent" : "skipped";
}
