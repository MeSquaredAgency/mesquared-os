import { repository } from "@/lib/data";
import type { NewScheduledAction } from "@/lib/data/repository";
import { emit, subscribe } from "@/lib/events";
import { leadDisplayName } from "@/lib/leads";
import { channelFor, sendMessage, templates } from "@/lib/messaging";
import { bookingLinkFor } from "@/lib/scheduling/calcom";
import type { ContactRecord, LeadRecord, ScheduledActionRecord, TenantSummary } from "@/lib/types";

/**
 * Automation handlers. Two entry points:
 *   - event subscribers (registered once per process) react immediately and
 *     queue later work as ScheduledActions
 *   - `runScheduledAction` executes queued work when the jobs tick finds it due
 *
 * Every handler checks the tenant has the type enabled, logs an
 * AutomationRun, and sends under the tenant's identity through the messenger.
 */

async function automationSettings(tenantId: string, typeKey: string): Promise<Record<string, unknown> | null> {
  const cfg = await repository.getTenantConfig(tenantId);
  const a = cfg.automations.find((x) => x.typeKey === typeKey);
  return a?.enabled ? a.settings : null;
}

const num = (s: Record<string, unknown>, key: string, fallback: number) => (typeof s[key] === "number" ? (s[key] as number) : fallback);
const hours = (h: number) => h * 3_600_000;

const tenantById = (tenantId: string): Promise<TenantSummary | null> => repository.findTenantById(tenantId);

/** Marketing (non-transactional) messages need recorded consent in regions that require it. */
function consentOk(tenant: TenantSummary, contact: ContactRecord, channel: "SMS" | "WHATSAPP" | "EMAIL"): boolean {
  const key = channel.toLowerCase() as "sms" | "whatsapp" | "email";
  const needs = tenant.region.toUpperCase() === "US" ? ["sms", "whatsapp"] : ["whatsapp"];
  if (!needs.includes(key)) return true;
  return Boolean(contact.consent[key]?.granted);
}

async function schedule(tenantId: string, data: NewScheduledAction) {
  return repository.scheduleAction(tenantId, data);
}

// ---------------------------------------------------------------------------
// booking_lifecycle: confirm now, remind before, follow up after, auto-complete
// ---------------------------------------------------------------------------

export async function onBookingCreated(tenant: TenantSummary, lead: LeadRecord, bookingId: string, startsAt: Date | null, endsAt: Date | null) {
  const settings = await automationSettings(tenant.id, "booking_lifecycle");
  if (!settings) return;
  const name = leadDisplayName(lead);
  const channel = channelFor(tenant, lead);
  const when = startsAt ? startsAt.toLocaleString(tenant.locale, { timeZone: tenant.timezone, dateStyle: "full", timeStyle: "short" }) : null;

  if (channel) {
    const run = await repository.recordAutomationRun(tenant.id, { typeKey: "booking_lifecycle", outcome: "SENT", summary: `Confirmed ${name}'s appointment${when ? ` for ${when}` : ""}.`, leadId: lead.id, contactId: lead.contactId, details: { bookingId } });
    const msg = templates.bookingConfirmation({ tenant, firstName: lead.firstName, when, channel });
    await sendMessage({ tenant, contactId: lead.contactId, channel, to: channel === "EMAIL" ? lead.email! : lead.phone!, body: msg.body, subject: msg.subject, automationRunId: run.id, transactional: true });
    await repository.updateBooking(tenant.id, bookingId, { confirmedAt: new Date() });
  }

  if (startsAt) {
    const reminderAt = new Date(startsAt.getTime() - hours(num(settings, "reminderHoursBefore", 24)));
    if (reminderAt.getTime() > Date.now()) {
      await schedule(tenant.id, { typeKey: "booking_lifecycle", action: "reminder", runAt: reminderAt, payload: { bookingId, leadId: lead.id }, dedupeKey: `booking:${bookingId}:reminder` });
    }
    const end = endsAt ?? new Date(startsAt.getTime() + hours(1));
    await schedule(tenant.id, { typeKey: "booking_lifecycle", action: "auto_complete", runAt: new Date(end.getTime() + hours(2)), payload: { bookingId, leadId: lead.id }, dedupeKey: `booking:${bookingId}:auto_complete` });
  }
}

export async function onBookingCompleted(tenant: TenantSummary, lead: LeadRecord, bookingId: string) {
  const lifecycle = await automationSettings(tenant.id, "booking_lifecycle");
  if (lifecycle) {
    await schedule(tenant.id, { typeKey: "booking_lifecycle", action: "follow_up", runAt: new Date(Date.now() + hours(num(lifecycle, "followUpHoursAfter", 24))), payload: { bookingId, leadId: lead.id }, dedupeKey: `booking:${bookingId}:follow_up` });
  }
  const review = await automationSettings(tenant.id, "review_request");
  if (review) {
    await schedule(tenant.id, { typeKey: "review_request", action: "ask", runAt: new Date(Date.now() + hours(num(review, "delayHours", 3))), payload: { bookingId, leadId: lead.id, contactId: lead.contactId }, dedupeKey: `review:${lead.contactId ?? lead.id}:${bookingId}` });
  }
}

// ---------------------------------------------------------------------------
// reactivation and missed-call reply
// ---------------------------------------------------------------------------

export async function onContactLapsed(tenant: TenantSummary, contact: ContactRecord) {
  const settings = await automationSettings(tenant.id, "reactivation");
  if (!settings) return;
  const channel = channelFor(tenant, contact);
  const name = leadDisplayName(contact);
  if (!channel) {
    await repository.recordAutomationRun(tenant.id, { typeKey: "reactivation", outcome: "SKIPPED", summary: `${name} has lapsed but left no way to reach them.`, contactId: contact.id });
    return;
  }
  if (!consentOk(tenant, contact, channel)) {
    await repository.recordAutomationRun(tenant.id, { typeKey: "reactivation", outcome: "SKIPPED", summary: `${name} has lapsed; no marketing consent recorded for ${channel.toLowerCase()}, so nothing was sent.`, contactId: contact.id });
    return;
  }
  const run = await repository.recordAutomationRun(tenant.id, { typeKey: "reactivation", outcome: "SENT", summary: `Invited ${name} back by ${channel === "EMAIL" ? "email" : channel === "SMS" ? "SMS" : "WhatsApp"}.`, contactId: contact.id });
  const bookingUrl = await bookingLinkFor(tenant, { id: `contact_${contact.id}`, firstName: contact.firstName, lastName: contact.lastName, email: contact.email, phone: contact.phone });
  const msg = templates.reactivation({ tenant, firstName: contact.firstName, bookingUrl, channel });
  await sendMessage({ tenant, contactId: contact.id, channel, to: channel === "EMAIL" ? contact.email! : contact.phone!, body: msg.body, subject: msg.subject, automationRunId: run.id, transactional: false });
}

export async function onMissedCall(tenant: TenantSummary, contact: ContactRecord) {
  const settings = await automationSettings(tenant.id, "enquiry_auto_reply");
  if (!settings || settings.missedCallReply === false || !contact.phone) return;
  const run = await repository.recordAutomationRun(tenant.id, { typeKey: "enquiry_auto_reply", outcome: "SENT", summary: `Texted ${leadDisplayName(contact)} straight after their missed call with a booking link.`, contactId: contact.id });
  const bookingUrl = await bookingLinkFor(tenant, { id: `contact_${contact.id}`, firstName: contact.firstName, lastName: contact.lastName, email: contact.email, phone: contact.phone });
  const channel = channelFor(tenant, contact) ?? "SMS";
  const body = templates.missedCallSms({ tenant, firstName: contact.firstName, bookingUrl });
  await sendMessage({ tenant, contactId: contact.id, channel: channel === "EMAIL" ? "SMS" : channel, to: contact.phone, body, automationRunId: run.id, transactional: true });
}

/** The RED-side auto reply (e.g. renter availability questions) when the tenant has configured text for it. */
export async function onRedEnquiry(tenant: TenantSummary, lead: LeadRecord) {
  const settings = await automationSettings(tenant.id, "enquiry_auto_reply");
  if (!settings || !settings.renterReply) return;
  const channel = channelFor(tenant, lead);
  if (!channel) return;
  const run = await repository.recordAutomationRun(tenant.id, { typeKey: "enquiry_auto_reply", outcome: "SENT", summary: `Replied to ${leadDisplayName(lead)}'s ${typeof lead.attributes.property === "string" ? `question about ${lead.attributes.property}` : "enquiry"} with the next steps.`, leadId: lead.id, contactId: lead.contactId });
  const msg = templates.generalReply({ tenant, firstName: lead.firstName, channel, custom: typeof settings.redReplyText === "string" ? settings.redReplyText : null });
  await sendMessage({ tenant, contactId: lead.contactId, channel, to: channel === "EMAIL" ? lead.email! : lead.phone!, body: msg.body, subject: msg.subject, automationRunId: run.id, transactional: true });
  await repository.markLeadResponded(tenant.id, lead.id, new Date());
}

// ---------------------------------------------------------------------------
// Scheduled work
// ---------------------------------------------------------------------------

export async function runScheduledAction(action: ScheduledActionRecord): Promise<void> {
  const tenant = await tenantById(action.tenantId);
  if (!tenant) throw new Error(`tenant ${action.tenantId} not found`);
  const leadId = typeof action.payload.leadId === "string" ? action.payload.leadId : null;
  const lead = leadId ? await repository.findLeadById(tenant.id, leadId) : null;

  switch (`${action.typeKey}:${action.action}`) {
    case "booking_lifecycle:reminder": {
      const booking = await repository.findBookingById(tenant.id, String(action.payload.bookingId));
      if (!booking || !lead || booking.status !== "SCHEDULED") return;
      const channel = channelFor(tenant, lead);
      if (!channel) return;
      const when = booking.startsAt ? booking.startsAt.toLocaleString(tenant.locale, { timeZone: tenant.timezone, weekday: "long", hour: "numeric", minute: "2-digit" }) : null;
      const run = await repository.recordAutomationRun(tenant.id, { typeKey: "booking_lifecycle", outcome: "SENT", summary: `Reminded ${leadDisplayName(lead)} about ${when ? `their appointment ${when}` : "their appointment"}.`, leadId: lead.id, contactId: lead.contactId });
      const msg = templates.bookingReminder({ tenant, firstName: lead.firstName, when, channel });
      await sendMessage({ tenant, contactId: lead.contactId, channel, to: channel === "EMAIL" ? lead.email! : lead.phone!, body: msg.body, subject: msg.subject, automationRunId: run.id, transactional: true });
      await repository.updateBooking(tenant.id, booking.id, { remindedAt: new Date() });
      return;
    }
    case "booking_lifecycle:auto_complete": {
      const booking = await repository.findBookingById(tenant.id, String(action.payload.bookingId));
      if (!booking || !lead || booking.status !== "SCHEDULED") return;
      await repository.updateBooking(tenant.id, booking.id, { status: "COMPLETED" });
      await emit(tenant.id, "booking.completed", { bookingId: booking.id, leadId: lead.id, auto: true });
      return;
    }
    case "booking_lifecycle:follow_up": {
      const booking = await repository.findBookingById(tenant.id, String(action.payload.bookingId));
      if (!booking || !lead || booking.status !== "COMPLETED") return;
      const channel = channelFor(tenant, lead);
      if (!channel) return;
      const run = await repository.recordAutomationRun(tenant.id, { typeKey: "booking_lifecycle", outcome: "SENT", summary: `Followed up with ${leadDisplayName(lead)} after their appointment.`, leadId: lead.id, contactId: lead.contactId });
      const msg = templates.bookingFollowUp({ tenant, firstName: lead.firstName, channel });
      await sendMessage({ tenant, contactId: lead.contactId, channel, to: channel === "EMAIL" ? lead.email! : lead.phone!, body: msg.body, subject: msg.subject, automationRunId: run.id, transactional: true });
      await repository.updateBooking(tenant.id, booking.id, { followedUpAt: new Date() });
      return;
    }
    case "review_request:ask": {
      const settings = await automationSettings(tenant.id, "review_request");
      if (!settings) return;
      const contactId = typeof action.payload.contactId === "string" ? action.payload.contactId : lead?.contactId ?? null;
      const contact = contactId ? await repository.findContactById(tenant.id, contactId) : null;
      if (!contact) return;
      const channel = channelFor(tenant, contact);
      if (!channel) return;
      const reviewUrl = typeof settings.reviewUrl === "string" ? settings.reviewUrl : null;
      if (!reviewUrl) {
        await repository.recordAutomationRun(tenant.id, { typeKey: "review_request", outcome: "SKIPPED", summary: `Would have asked ${leadDisplayName(contact)} for a review, but no review link is configured for this workspace.`, contactId: contact.id, leadId: lead?.id ?? null });
        return;
      }
      const run = await repository.recordAutomationRun(tenant.id, { typeKey: "review_request", outcome: "SENT", summary: `Asked ${leadDisplayName(contact)} for a review.`, contactId: contact.id, leadId: lead?.id ?? null });
      const msg = templates.reviewRequest({ tenant, firstName: contact.firstName, reviewUrl, channel });
      await sendMessage({ tenant, contactId: contact.id, channel, to: channel === "EMAIL" ? contact.email! : contact.phone!, body: msg.body, subject: msg.subject, automationRunId: run.id, transactional: true });
      return;
    }
    case "chase_information:chase": {
      const settings = await automationSettings(tenant.id, "chase_information");
      const request = (await repository.listInformationRequests(tenant.id, { status: ["OPEN"], limit: 500 })).find((r) => r.id === action.payload.requestId);
      if (!settings || !request) return;
      const contact = request.contactId ? await repository.findContactById(tenant.id, request.contactId) : null;
      const maxChases = num(settings, "maxChases", 3);
      if (request.chaseCount >= maxChases) {
        await repository.updateInformationRequest(tenant.id, request.id, { status: "ESCALATED" });
        await repository.createException(tenant.id, { reason: `${contact ? leadDisplayName(contact) : "A contact"} hasn't sent ${request.description} after ${request.chaseCount} reminders.`, suggestedAction: "Call them, or close the request if it no longer matters.", confidence: 0.7, contactId: request.contactId, leadId: request.leadId });
        await repository.recordAutomationRun(tenant.id, { typeKey: "chase_information", outcome: "ESCALATED", summary: `Stopped chasing ${contact ? leadDisplayName(contact) : "a contact"} for ${request.description} after ${request.chaseCount} reminders; raised for an operator.`, contactId: request.contactId, leadId: request.leadId });
        return;
      }
      const channel = contact ? channelFor(tenant, contact) : null;
      if (!contact || !channel) return;
      const run = await repository.recordAutomationRun(tenant.id, { typeKey: "chase_information", outcome: "SENT", summary: `Reminded ${leadDisplayName(contact)} about ${request.description} (${request.chaseCount + 1} of ${maxChases}).`, contactId: contact.id, leadId: request.leadId });
      const msg = templates.chase({ tenant, firstName: contact.firstName, what: request.description, channel });
      await sendMessage({ tenant, contactId: contact.id, channel, to: channel === "EMAIL" ? contact.email! : contact.phone!, body: msg.body, subject: msg.subject, automationRunId: run.id, transactional: true });
      await repository.updateInformationRequest(tenant.id, request.id, { chaseCount: request.chaseCount + 1, lastChasedAt: new Date() });
      await schedule(tenant.id, { typeKey: "chase_information", action: "chase", runAt: new Date(Date.now() + num(settings, "chaseEveryDays", 2) * 86_400_000), payload: { requestId: request.id }, dedupeKey: `request:${request.id}:chase:${request.chaseCount + 1}` });
      return;
    }
    default:
      throw new Error(`No handler for ${action.typeKey}:${action.action}`);
  }
}

/** Opens an information request and schedules the first chase. */
export async function openInformationRequest(tenant: TenantSummary, input: { contactId: string | null; leadId: string | null; kind: string; description: string; dueAt: Date | null }) {
  const request = await repository.createInformationRequest(tenant.id, input);
  const settings = await automationSettings(tenant.id, "chase_information");
  if (settings) {
    await repository.scheduleAction(tenant.id, { typeKey: "chase_information", action: "chase", runAt: input.dueAt ?? new Date(Date.now() + num(settings, "chaseEveryDays", 2) * 86_400_000), payload: { requestId: request.id }, dedupeKey: `request:${request.id}:chase:0` });
  }
  await emit(tenant.id, "request.opened", { requestId: request.id, kind: input.kind, contactId: input.contactId, leadId: input.leadId });
  return request;
}

let registered = false;

/** Wires the handlers to the event stream once per process. */
export function registerAutomations() {
  if (registered) return;
  registered = true;

  subscribe("booking.created", async (e) => {
    const tenant = await tenantById(e.tenantId);
    const lead = tenant && typeof e.payload.leadId === "string" ? await repository.findLeadById(tenant.id, e.payload.leadId) : null;
    if (!tenant || !lead || typeof e.payload.bookingId !== "string") return;
    await onBookingCreated(tenant, lead, e.payload.bookingId, e.payload.startsAt ? new Date(String(e.payload.startsAt)) : null, e.payload.endsAt ? new Date(String(e.payload.endsAt)) : null);
  });

  subscribe("booking.completed", async (e) => {
    const tenant = await tenantById(e.tenantId);
    const lead = tenant && typeof e.payload.leadId === "string" ? await repository.findLeadById(tenant.id, e.payload.leadId) : null;
    if (!tenant || !lead || typeof e.payload.bookingId !== "string") return;
    await onBookingCompleted(tenant, lead, e.payload.bookingId);
  });

  subscribe("missed_opportunity.detected", async (e) => {
    if (e.payload.type !== "LAPSED_CUSTOMER" || typeof e.payload.contactId !== "string") return;
    const tenant = await tenantById(e.tenantId);
    const contact = tenant ? await repository.findContactById(tenant.id, e.payload.contactId) : null;
    if (tenant && contact) await onContactLapsed(tenant, contact);
  });

  subscribe("lead.qualified", async (e) => {
    if (e.payload.ticketType !== "RED") return;
    const tenant = await repository.findTenantBySlug(String(e.payload.tenantSlug ?? ""));
    const lead = tenant ? await repository.findLeadById(tenant.id, String(e.payload.leadId)) : null;
    if (tenant && lead) await onRedEnquiry(tenant, lead);
  });
}
