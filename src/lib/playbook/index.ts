import { repository } from "@/lib/data";
import { emit, subscribe } from "@/lib/events";
import { leadDisplayName } from "@/lib/leads";
import { channelFor, sendMessage, templates } from "@/lib/messaging";
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

  // 2. Acknowledge
  if (enabled("enquiry_auto_reply")) {
    const channel = channelFor(tenant, lead);
    if (!channel) {
      await repository.recordAutomationRun(tenant.id, { typeKey: "enquiry_auto_reply", outcome: "SKIPPED", summary: `${name} left no phone or email, so no acknowledgement could be sent.`, leadId: lead.id, contactId: lead.contactId });
    } else {
      const topic = typeof lead.attributes.service === "string" ? lead.attributes.service : null;
      const run = await repository.recordAutomationRun(tenant.id, { typeKey: "enquiry_auto_reply", outcome: "SENT", summary: `Acknowledged ${name} by ${channel === "EMAIL" ? "email" : channel === "SMS" ? "SMS" : "WhatsApp"} with a booking link.`, leadId: lead.id, contactId: lead.contactId, details: { bookingUrl, channel } });
      const content = channel === "EMAIL" ? templates.acknowledgementEmail({ tenant, firstName: lead.firstName, bookingUrl, topic }) : { subject: undefined, body: templates.acknowledgementSms({ tenant, firstName: lead.firstName, bookingUrl, topic }) };
      const result = await sendMessage({ tenant, contactId: lead.contactId, channel, to: channel === "EMAIL" ? lead.email! : lead.phone!, body: content.body, subject: content.subject, automationRunId: run.id, transactional: true });
      if (result.ok) {
        await repository.markLeadResponded(tenant.id, lead.id, new Date());
        await repository.createBooking(tenant.id, { leadId: lead.id, bookingUrl, sent: true });
        await emit(tenant.id, "message.sent", { leadId: lead.id, channel, automationRunId: run.id, simulated: result.simulated }, run.id);
      } else {
        await repository.createBooking(tenant.id, { leadId: lead.id, bookingUrl, sent: false });
        await repository.recordAutomationRun(tenant.id, { typeKey: "enquiry_auto_reply", outcome: result.simulated ? "SKIPPED" : "FAILED", summary: result.simulated ? `${name} is waiting for a reply: messaging isn’t connected for this workspace yet (booking link is ready).` : `Couldn’t send the acknowledgement to ${name}: ${result.error}`, leadId: lead.id, contactId: lead.contactId, details: { error: result.error, bookingUrl } });
        if (!result.simulated) await repository.createException(tenant.id, { reason: `Acknowledgement to ${name} failed: ${result.error}`, suggestedAction: "Reply by hand, then check the messaging integration.", confidence: 0.9, leadId: lead.id, contactId: lead.contactId });
      }
    }
  } else {
    await repository.createBooking(tenant.id, { leadId: lead.id, bookingUrl, sent: false });
  }

  // 3. Alert the assigned people
  const recipients = await repository.listAlertRecipients(tenant.id);
  if (recipients.length > 0) {
    const portalUrl = `${(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/app/${tenant.slug}/leads`;
    const mail = templates.leadAlertEmail({ tenant, leadName: name, summary: lead.message ?? "(no message)", score: lead.intentScore ?? 0, reason: lead.qualificationReason ?? "", phone: lead.phone, email: lead.email, portalUrl });
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
    const tenant = await repository.findTenantBySlug(String(event.payload.tenantSlug ?? ""));
    const lead = await repository.findLeadById(event.tenantId, String(event.payload.leadId));
    if (!tenant || !lead) return;
    await runGreenLeadPlaybook(tenant, lead);
  });
}
