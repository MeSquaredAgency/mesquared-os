import { repository } from "@/lib/data";
import { emit, subscribe } from "@/lib/events";
import { leadDisplayName } from "@/lib/leads";
import { channelFor, sendMessage, senderIdentity, templates, type OutboundChannel } from "@/lib/messaging";
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
export async function runGreenLeadPlaybook(tenant: TenantSummary, lead: LeadRecord): Promise<void> {
  const automations = (await repository.getTenantConfig(tenant.id)).automations;
  const enabled = (key: string) => automations.find((a) => a.typeKey === key)?.enabled ?? false;
  const name = leadDisplayName(lead);
  const bookingUrl = await bookingLinkFor(tenant, lead);
  let acknowledged: "SENT" | "HELD" | "SKIPPED" | "FAILED" | "NONE" = "NONE";

  // 2. Acknowledge: preferred channel for the region first, the other channel if that one isn't set up.
  if (enabled("enquiry_auto_reply")) {
    const preferred = channelFor(tenant, lead);
    const candidates: OutboundChannel[] = preferred ? [preferred, ...(preferred !== "EMAIL" && lead.email ? ["EMAIL" as const] : []), ...(preferred === "EMAIL" && lead.phone ? ["SMS" as const] : [])] : [];
    if (candidates.length === 0) {
      await repository.recordAutomationRun(tenant.id, { typeKey: "enquiry_auto_reply", outcome: "SKIPPED", summary: `${name} left no phone or email, so no acknowledgement could be sent.`, leadId: lead.id, contactId: lead.contactId });
    } else {
      const topic = safeTopic(typeof lead.attributes.service === "string" ? lead.attributes.service : null, tenant.qualificationRules.highIntentServices) ?? (tenant.qualificationRules.highIntentServices ?? []).find((s) => (lead.message ?? "").toLowerCase().includes(s.toLowerCase())) ?? null;
      const area = safeArea(`${lead.message ?? ""} ${typeof lead.attributes.suburb === "string" ? lead.attributes.suburb : ""}`, tenant.qualificationRules.serviceAreas);
      const identity = await senderIdentity(tenant, lead.assigneeId);
      let channel = candidates[0];
      let result = null as Awaited<ReturnType<typeof sendMessage>> | null;
      const run = await repository.recordAutomationRun(tenant.id, { typeKey: "enquiry_auto_reply", outcome: "SENT", summary: `Acknowledged ${name} with a booking link.`, leadId: lead.id, contactId: lead.contactId, details: { bookingLink: "prefilled" } });
      const notConfigured: string[] = [];
      for (const candidate of candidates) {
        channel = candidate;
        const content = channel === "EMAIL" ? templates.acknowledgementEmail({ tenant, firstName: lead.firstName, bookingUrl, topic, area, signedBy: identity.signedBy }) : { subject: undefined, body: templates.acknowledgementSms({ tenant, firstName: lead.firstName, bookingUrl, topic, area, signedBy: identity.signedBy }), cta: null };
        result = await sendMessage({ tenant, contactId: lead.contactId, channel, to: channel === "EMAIL" ? lead.email! : lead.phone!, body: content.body, subject: content.subject, automationRunId: run.id, transactional: true, replyTo: identity.replyTo, cta: content.cta, signature: identity.signature });
        if (result.ok || !result.simulated) break; // sent, or a real provider error worth surfacing; only "not configured" falls through
        notConfigured.push(channel === "EMAIL" ? "email" : channel === "SMS" ? "SMS" : "WhatsApp");
      }
      const outcome = result!;
      const label = channel === "EMAIL" ? "email" : channel === "SMS" ? "SMS" : "WhatsApp";
      if (outcome.ok) {
        acknowledged = "SENT";
        const fellBack = notConfigured.length ? ` (${notConfigured.join(" and ")} isn't set up for ${tenant.name} yet)` : "";
        await repository.updateAutomationRun(tenant.id, run.id, { outcome: "SENT", summary: `Acknowledged ${name} by ${label} with a booking link${fellBack}.` });
        await repository.markLeadResponded(tenant.id, lead.id, new Date());
        await repository.resolveMissedOpportunityByKey(tenant.id, `UNANSWERED_ENQUIRY:${lead.id}`, "RECOVERED");
        await repository.createBooking(tenant.id, { leadId: lead.id, bookingUrl, sent: true });
        await emit(tenant.id, "message.sent", { leadId: lead.id, channel, automationRunId: run.id, simulated: outcome.simulated }, run.id);
      } else {
        acknowledged = outcome.simulated ? "SKIPPED" : "FAILED";
        await repository.createBooking(tenant.id, { leadId: lead.id, bookingUrl, sent: false });
        await repository.updateAutomationRun(tenant.id, run.id, { outcome: outcome.simulated ? "SKIPPED" : "FAILED", summary: outcome.simulated ? `${name} is waiting for a reply: messaging isn’t connected for ${tenant.name} yet (their booking link is ready).` : `Couldn’t send the acknowledgement to ${name}: ${outcome.error}`, details: { error: outcome.error } });
        if (!outcome.simulated) await repository.createException(tenant.id, { reason: `Acknowledgement to ${name} failed: ${outcome.error}`, suggestedAction: "Reply by hand, then check the messaging integration.", confidence: 0.9, leadId: lead.id, contactId: lead.contactId });
      }
    }
  } else {
    await repository.createBooking(tenant.id, { leadId: lead.id, bookingUrl, sent: false });
  }

  // 3. Alert the assigned people
  const recipients = await repository.listAlertRecipients(tenant.id);
  if (recipients.length > 0) {
    const portalUrl = `${(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/app/${tenant.slug}/leads`;
    const mail = templates.leadAlertEmail({ tenant, leadName: name, summary: lead.message ?? "(no message)", score: lead.intentScore ?? 0, reason: lead.qualificationReason ?? "", phone: lead.phone, email: lead.email, portalUrl, acknowledged });
    const run = await repository.recordAutomationRun(tenant.id, { typeKey: "enquiry_auto_reply", outcome: "SENT", summary: `Told ${recipients.length === 1 ? recipients[0].name ?? recipients[0].email : `${recipients.length} people`} about ${name}.`, leadId: lead.id, contactId: lead.contactId, details: { recipients: recipients.map((r) => r.userId) } });
    for (const r of recipients) {
      await sendMessage({ tenant, contactId: null, channel: "EMAIL", to: r.email, body: mail.body, subject: mail.subject, automationRunId: run.id, transactional: true });
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
