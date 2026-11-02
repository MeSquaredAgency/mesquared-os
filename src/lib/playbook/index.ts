import { repository } from "@/lib/data";
import type { AlertRecipient } from "@/lib/data/repository";
import { emit, subscribe } from "@/lib/events";
import { leadDisplayName } from "@/lib/leads";
import { channelFor, destinationAllowed, sendMessage, senderIdentity, templates, textableNumber, type OutboundChannel } from "@/lib/messaging";
import { safeArea, safeTopic } from "@/lib/messaging/templates";
import { bookingLinkFor } from "@/lib/scheduling/calcom";
import type { LeadRecord, TenantSummary } from "@/lib/types";

/**
 * The green-lead playbook, run when `lead.qualified` fires with GREEN:
 *   1. the lead is already at the top of the dashboard (status QUALIFIED)
 *   2. instant acknowledgement with a booking link, by SMS/WhatsApp/email per region
 *   3. the people holding RECEIVE_LEAD_ALERTS are told
 *   4. the SLA watch (src/lib/opportunities) turns a missed window into a missed opportunity
 *
 * Every step logs an automation run so "Handled for you" reflects reality,
 * including when nothing could be sent.
 */
/**
 * Who gets a new lead. With `assign: "round_robin"` on the auto-reply
 * automation, the lead goes to whichever alert recipient has had the fewest
 * new leads in the last seven days (ties go to the first in the list), and
 * only that person is alerted. Otherwise nobody is assigned and everyone
 * holding RECEIVE_LEAD_ALERTS is told, as before.
 */
export async function assignNewLead(tenant: TenantSummary, lead: LeadRecord, settings: Record<string, unknown>, recipients: AlertRecipient[]): Promise<{ lead: LeadRecord; alert: AlertRecipient[]; assigned: AlertRecipient | null }> {
  if (settings.assign !== "round_robin" || recipients.length === 0) return { lead, alert: recipients, assigned: null };
  if (lead.assigneeId) {
    const owner = recipients.find((r) => r.userId === lead.assigneeId);
    return { lead, alert: owner ? [owner] : recipients, assigned: null };
  }
  const pool = Array.isArray(settings.assignTo) && settings.assignTo.length ? recipients.filter((r) => (settings.assignTo as unknown[]).includes(r.userId)) : recipients;
  const candidates = pool.length ? pool : recipients;
  const counts = await repository.countLeadsByAssignee(tenant.id, new Date(Date.now() - 7 * 86_400_000));
  const chosen = candidates.reduce((best, r) => ((counts[r.userId] ?? 0) < (counts[best.userId] ?? 0) ? r : best), candidates[0]);
  await repository.assignLead(tenant.id, lead.id, chosen.userId);
  await repository.recordAutomationRun(tenant.id, { typeKey: "enquiry_auto_reply", outcome: "COMPLETED", summary: `Assigned ${leadDisplayName(lead)} to ${chosen.name ?? chosen.email}.`, leadId: lead.id, contactId: lead.contactId });
  return { lead: { ...lead, assigneeId: chosen.userId }, alert: [chosen], assigned: chosen };
}

export async function runGreenLeadPlaybook(tenant: TenantSummary, incoming: LeadRecord): Promise<void> {
  const automations = (await repository.getTenantConfig(tenant.id)).automations;
  const enabled = (key: string) => automations.find((a) => a.typeKey === key)?.enabled ?? false;
  const autoReply = automations.find((a) => a.typeKey === "enquiry_auto_reply");
  // 0. Decide whose lead it is before anything is sent, so the acknowledgement can be signed by that person.
  const allRecipients = await repository.listAlertRecipients(tenant.id);
  const { lead, alert: recipients } = await assignNewLead(tenant, incoming, autoReply?.settings ?? {}, allRecipients);
  const name = leadDisplayName(lead);
  const bookingUrl = await bookingLinkFor(tenant, lead);
  let acknowledged: "SENT" | "HELD" | "SKIPPED" | "FAILED" | "NONE" = "NONE";

  // 2. Acknowledge: preferred channel for the region first, the other channel if that one isn't set up.
  if (enabled("enquiry_auto_reply")) {
    const preferred = channelFor(tenant, lead);
    const wanted: OutboundChannel[] = preferred ? [preferred, ...(preferred !== "EMAIL" && lead.email ? ["EMAIL" as const] : []), ...(preferred === "EMAIL" && lead.phone ? ["SMS" as const] : [])] : [];
    // A number outside the countries this workspace may text is not a provider failure: skip it and use email.
    const candidates = wanted.filter((c) => c === "EMAIL" || destinationAllowed(tenant, lead.phone ?? ""));
    if (candidates.length === 0) {
      const why = wanted.length ? `${name}'s number is outside the countries this workspace may text and they left no email` : `${name} left no phone or email`;
      await repository.recordAutomationRun(tenant.id, { typeKey: "enquiry_auto_reply", outcome: "SKIPPED", summary: `${why}, so no acknowledgement could be sent.`, leadId: lead.id, contactId: lead.contactId });
    } else {
      const topic = safeTopic(typeof lead.attributes.service === "string" ? lead.attributes.service : null, tenant.qualificationRules.highIntentServices) ?? (tenant.qualificationRules.highIntentServices ?? []).find((s) => (lead.message ?? "").toLowerCase().includes(s.toLowerCase())) ?? null;
      const area = safeArea(`${lead.message ?? ""} ${typeof lead.attributes.suburb === "string" ? lead.attributes.suburb : ""}`, tenant.qualificationRules.serviceAreas);
      const identity = await senderIdentity(tenant, lead.assigneeId);
      let channel = candidates[0];
      let result = null as Awaited<ReturnType<typeof sendMessage>> | null;
      const run = await repository.recordAutomationRun(tenant.id, { typeKey: "enquiry_auto_reply", outcome: "SENT", summary: `Acknowledged ${name} with a booking link.`, leadId: lead.id, contactId: lead.contactId, details: { bookingLink: "prefilled" } });
      const notConfigured: string[] = [];
      const failures: string[] = [];
      for (const candidate of candidates) {
        channel = candidate;
        const content = channel === "EMAIL" ? templates.acknowledgementEmail({ tenant, firstName: lead.firstName, bookingUrl, topic, area, signedBy: identity.signedBy }) : { subject: undefined, body: templates.acknowledgementSms({ tenant, firstName: lead.firstName, bookingUrl, topic, area, signedBy: identity.signedBy }), cta: null };
        result = await sendMessage({ tenant, contactId: lead.contactId, channel, to: channel === "EMAIL" ? lead.email! : lead.phone!, body: content.body, subject: content.subject, automationRunId: run.id, transactional: true, replyTo: identity.replyTo, cta: content.cta, signature: identity.signature });
        if (result.ok || result.held) break;
        // "Not configured" and a provider refusal both fall through to the next channel: the person must hear back either way.
        const tried = channel === "EMAIL" ? "email" : channel === "SMS" ? "SMS" : "WhatsApp";
        if (result.simulated) notConfigured.push(tried);
        else failures.push(`the ${tried} couldn't be sent: ${result.error}`);
      }
      const outcome = result!;
      const skippedOnly = failures.length === 0 && outcome.simulated;
      const label = channel === "EMAIL" ? "email" : channel === "SMS" ? "SMS" : "WhatsApp";
      if (outcome.ok) {
        acknowledged = "SENT";
        const notes = [...(notConfigured.length ? [`${notConfigured.join(" and ")} isn't set up for ${tenant.name} yet`] : []), ...failures];
        const fellBack = notes.length ? ` (${notes.join("; ")})` : "";
        await repository.updateAutomationRun(tenant.id, run.id, { outcome: "SENT", summary: `Acknowledged ${name} by ${label} with a booking link${fellBack}.` });
        await repository.markLeadResponded(tenant.id, lead.id, new Date());
        await repository.resolveMissedOpportunityByKey(tenant.id, `UNANSWERED_ENQUIRY:${lead.id}`, "RECOVERED");
        await repository.createBooking(tenant.id, { leadId: lead.id, bookingUrl, sent: true });
        await emit(tenant.id, "message.sent", { leadId: lead.id, channel, automationRunId: run.id, simulated: outcome.simulated }, run.id);
      } else {
        acknowledged = skippedOnly ? "SKIPPED" : "FAILED";
        await repository.createBooking(tenant.id, { leadId: lead.id, bookingUrl, sent: false });
        await repository.updateAutomationRun(tenant.id, run.id, { outcome: skippedOnly ? "SKIPPED" : "FAILED", summary: skippedOnly ? `${name} is waiting for a reply: messaging isn’t connected for ${tenant.name} yet (their booking link is ready).` : `Couldn’t send the acknowledgement to ${name}: ${failures.join("; ") || outcome.error}`, details: { error: failures.join("; ") || outcome.error } });
        if (!skippedOnly) await repository.createException(tenant.id, { reason: `Acknowledgement to ${name} failed: ${failures.join("; ") || outcome.error}`, suggestedAction: "Reply by hand, then check the messaging integration.", confidence: 0.9, leadId: lead.id, contactId: lead.contactId });
      }
    }
  } else {
    await repository.createBooking(tenant.id, { leadId: lead.id, bookingUrl, sent: false });
  }

  // 3. Alert the assigned person, or everyone who holds lead alerts when nobody is assigned: a text to their phone
  //    first (that is the moment), the full details by email.
  if (recipients.length > 0) {
    const portalUrl = `${(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/app/${tenant.slug}/leads`;
    const topic = safeTopic(typeof lead.attributes.service === "string" ? lead.attributes.service : null, tenant.qualificationRules.highIntentServices) ?? (tenant.qualificationRules.highIntentServices ?? []).find((s) => (lead.message ?? "").toLowerCase().includes(s.toLowerCase())) ?? null;
    const area = safeArea(`${lead.message ?? ""} ${typeof lead.attributes.suburb === "string" ? lead.attributes.suburb : ""}`, tenant.qualificationRules.serviceAreas);
    const mail = templates.leadAlertEmail({ tenant, leadName: name, summary: lead.message ?? "(no message)", score: lead.intentScore ?? 0, reason: lead.qualificationReason ?? "", phone: lead.phone, email: lead.email, portalUrl, acknowledged });
    const text = templates.leadAlertSms({ tenant, leadName: name, topic, area, phone: lead.phone, acknowledged });
    const run = await repository.recordAutomationRun(tenant.id, { typeKey: "enquiry_auto_reply", outcome: "SENT", summary: `Told ${recipients.length === 1 ? recipients[0].name ?? recipients[0].email : `${recipients.length} people`} about ${name}.`, leadId: lead.id, contactId: lead.contactId, details: { recipients: recipients.map((r) => r.userId) } });
    const bySms = autoReply?.settings.alertBySms !== false;
    const phones = bySms ? new Map((await repository.listTenantPeople(tenant.id)).filter((p) => p.via === "member").map((p) => [p.userId, textableNumber(tenant, p.phone)] as const).filter((e): e is readonly [string, string] => e[1] !== null)) : new Map<string, string>();
    const reached: string[] = [];
    const failed: string[] = [];
    let texted = 0;
    let notConfigured = 0;
    for (const r of recipients) {
      const phone = phones.get(r.userId);
      if (phone) {
        const buzz = await sendMessage({ tenant, contactId: null, channel: "SMS", to: phone, body: text, automationRunId: run.id, transactional: true });
        if (buzz.ok) texted++;
        else if (!buzz.simulated) console.error(`[playbook] text to ${phone.slice(0, 4)}… for ${tenant.slug} failed: ${buzz.error}`);
      }
      const sent = await sendMessage({ tenant, contactId: null, channel: "EMAIL", to: r.email, body: mail.body, subject: mail.subject, automationRunId: run.id, transactional: true });
      (sent.ok ? reached : failed).push(r.name ?? r.email);
      if (!sent.ok && sent.simulated) notConfigured++;
      else if (!sent.ok) console.error(`[playbook] alert to ${r.email.slice(0, 3)}… for ${tenant.slug} failed: ${sent.error}`);
    }
    if (texted > 0 && reached.length > 0) await repository.updateAutomationRun(tenant.id, run.id, { outcome: "SENT", summary: `Told ${reached.join(", ")} about ${name} by text and email.` });
    if (reached.length === 0 && notConfigured === failed.length) {
      // Email is not set up at all (demo, or a deployment without a from-address): say so, no exception per lead.
      await repository.updateAutomationRun(tenant.id, run.id, { outcome: "SKIPPED", summary: `Couldn't tell anyone about ${name}: email isn't connected for ${tenant.name} yet.` });
    } else if (reached.length === 0) {
      // The log must say nobody was told, and a person must be found another way.
      await repository.updateAutomationRun(tenant.id, run.id, { outcome: "FAILED", summary: `Couldn't tell anyone about ${name}: ${failed.length} alert${failed.length === 1 ? "" : "s"} failed to send.` });
      await repository.createException(tenant.id, { reason: `Nobody was alerted about ${name}; the lead alert could not be sent.`, suggestedAction: "Call them, then check the email provider and the people who receive lead alerts.", confidence: 0.9, leadId: lead.id, contactId: lead.contactId });
    } else if (failed.length) {
      await repository.updateAutomationRun(tenant.id, run.id, { outcome: "SENT", summary: `Told ${reached.join(", ")} about ${name}; could not reach ${failed.join(", ")}.` });
    }
    await emit(tenant.id, "alert.sent", { leadId: lead.id, recipients: recipients.map((r) => r.userId) }, run.id);
  }
}

let registered = false;

/** Wires the playbook to the event stream once per process. */
export function registerPlaybook() {
  if (registered) return;
  registered = true;
  subscribe("lead.qualified", async (event) => {
    if (event.payload.ticketType !== "GREEN") return;
    const tenant = await repository.findTenantById(event.tenantId);
    const lead = await repository.findLeadById(event.tenantId, String(event.payload.leadId));
    if (!tenant || !lead) return;
    await runGreenLeadPlaybook(tenant, lead);
  });
}
