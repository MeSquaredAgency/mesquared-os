import { repository } from "@/lib/data";
import type { NewScheduledAction } from "@/lib/data/repository";
import { emit, subscribe } from "@/lib/events";
import { leadDisplayName } from "@/lib/leads";
import { channelFor, clampOutOfQuietHours, destinationAllowed, sendMessage, templates, textableNumber, type OutboundChannel, senderIdentity, type SenderIdentity, type MessageCta, type MessageSignature } from "@/lib/messaging";
import { safeAreas, whenPhrase } from "@/lib/messaging/templates";
import { bookingLinkFor } from "@/lib/scheduling/calcom";
import { runContentBatch } from "@/lib/content/engine";
import { runAdsSync } from "@/lib/ads/sync";
import { runFinanceSync } from "@/lib/finance/sync";
import { rollupSite } from "@/lib/website/rollup";
import { describeListing, findListingMentioned, findListingsMatching, listingNeeds } from "@/lib/inventory";
import { runInventorySync } from "@/lib/inventory/sync";
import { runSocialSync } from "@/lib/social/sync";
import { ingestMetaLead, metaLeadRefFromPayload } from "@/lib/intake/channels/meta-lead";
import { registerReconciler } from "@/lib/opportunities/reconcile";
import { expireStaleOpportunities } from "@/lib/opportunities/expire";
import { sendWeeklyDigest } from "@/lib/digest/weekly";
import { runGreenLeadPlaybook } from "@/lib/playbook";
import { log } from "@/lib/log";
import { registerPipelineAdvancement } from "@/lib/pipelines/advance";
import type { AutomationOutcome, ContactRecord, LeadRecord, ScheduledActionRecord, TenantSummary } from "@/lib/types";

export const ACTION_LEASE_MS = 10 * 60_000;

/** A scheduled action that can never succeed (bad payload, no handler): the tick fails it at once instead of retrying. */
export class NonRetryableError extends Error {
  readonly retryable = false;
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableError";
  }
}

/**
 * Automation handlers. Two entry points:
 *   - event subscribers (registered once per process) react immediately and
 *     queue later work as ScheduledActions
 *   - `runScheduledAction` executes queued work when the jobs tick finds it due
 *
 * Every handler checks the tenant has the type enabled and sends under the
 * tenant's identity through the messenger. The AutomationRun it logs reflects
 * what actually happened: SENT only after the provider accepted the message,
 * SKIPPED when the message was held or not configured, FAILED (with an
 * exception for an operator) when a real send failed.
 */

async function automationSettings(tenantId: string, typeKey: string): Promise<Record<string, unknown> | null> {
  const cfg = await repository.getTenantConfig(tenantId);
  const a = cfg.automations.find((x) => x.typeKey === typeKey);
  return a?.enabled ? a.settings : null;
}

const num = (s: Record<string, unknown>, key: string, fallback: number) => (typeof s[key] === "number" ? (s[key] as number) : fallback);
const hours = (h: number) => h * 3_600_000;
const channelName = (c: OutboundChannel) => (c === "EMAIL" ? "email" : c === "SMS" ? "SMS" : "WhatsApp");
const addressFor = (c: OutboundChannel, who: { email: string | null; phone: string | null }) => (c === "EMAIL" ? who.email! : who.phone!);

const tenantById = (tenantId: string): Promise<TenantSummary | null> => repository.findTenantById(tenantId);

async function schedule(tenantId: string, data: NewScheduledAction) {
  return repository.scheduleAction(tenantId, data);
}

interface SendAndLogInput {
  tenant: TenantSummary;
  typeKey: string;
  /** Who the message goes to; the channel order comes from the region (phone first) with the other as fallback. */
  recipient: { email: string | null; phone: string | null };
  /** Builds the message for whichever channel ends up being used. */
  compose: (channel: OutboundChannel, signedBy: string | null) => { body: string; subject?: string; cta?: MessageCta | null };
  /** Who signs it; resolved from the lead's assignee by callers that have one. Defaults to the business. */
  identity?: SenderIdentity;
  /** Restrict to these channels (e.g. a missed-call reply is never an email). */
  only?: OutboundChannel[];
  contactId: string | null;
  leadId: string | null;
  transactional: boolean;
  /** Summary when the message went out, e.g. "Reminded Margaret about their appointment." */
  sent: string;
  /** Who the message was for, for the honest alternatives ("Didn't remind Margaret: …"). */
  who: string;
  /** What we were trying to do, in a few words: "remind", "follow up with", "ask … for a review". */
  verb: string;
}

/** Channels we can reach this person on, preferred first; the other one is the fallback when the first isn't connected. */
export function channelsFor(tenant: TenantSummary, who: { email: string | null; phone: string | null }, only?: OutboundChannel[]): OutboundChannel[] {
  const preferred = channelFor(tenant, who);
  const list: OutboundChannel[] = preferred ? [preferred] : [];
  if (preferred !== "EMAIL" && who.email) list.push("EMAIL");
  if (preferred === "EMAIL" && who.phone) list.push("SMS");
  return only ? list.filter((c) => only.includes(c)) : list;
}

/**
 * Sends one message and logs a single run that tells the truth. The run is
 * created first (so the Message row can reference it) and corrected afterwards.
 * When the preferred channel isn't connected for the tenant, the other channel
 * is tried; a real provider error is not retried on another channel.
 */
export async function sendAndLog(input: SendAndLogInput) {
  const { tenant } = input;
  const wanted = channelsFor(tenant, input.recipient, input.only);
  // A number outside the countries this workspace may text is skipped, not reported as a failure; email still goes.
  const candidates = wanted.filter((c) => c === "EMAIL" || destinationAllowed(tenant, addressFor(c, input.recipient)));
  if (candidates.length === 0) {
    const run = await skipped(tenant.id, input.typeKey, wanted.length ? `Couldn't ${input.verb} ${input.who}: their number is outside the countries this workspace may text and they left no email.` : `Couldn't ${input.verb} ${input.who}: they left no way to reach them.`, { contactId: input.contactId, leadId: input.leadId });
    return { ok: false, providerMessageId: null, error: "no channel", simulated: false, messageId: null, runId: run.id, channel: null as OutboundChannel | null };
  }
  const run = await repository.recordAutomationRun(tenant.id, { typeKey: input.typeKey, outcome: "SENT", summary: input.sent, contactId: input.contactId, leadId: input.leadId });
  let channel = candidates[0];
  let result: Awaited<ReturnType<typeof sendMessage>> | null = null;
  const notConnected: string[] = [];
  for (const candidate of candidates) {
    channel = candidate;
    const msg = input.compose(channel, input.identity?.signedBy ?? null);
    result = await sendMessage({ tenant, contactId: input.contactId, channel, to: addressFor(channel, input.recipient), body: msg.body, subject: msg.subject, automationRunId: run.id, transactional: input.transactional, replyTo: input.identity?.replyTo ?? null, cta: msg.cta ?? null, signature: input.identity?.signature ?? null });
    if (result.ok || !result.simulated) break;
    notConnected.push(channelName(channel));
  }
  const outcome = result!;
  if (outcome.ok) {
    const note = notConnected.length ? ` (${notConnected.join(" and ")} isn't connected for ${tenant.name} yet)` : "";
    if (note || !/\bby (SMS|email|WhatsApp)\b/.test(input.sent)) await repository.updateAutomationRun(tenant.id, run.id, { outcome: "SENT", summary: `${input.sent.replace(/\.$/, "")} by ${channelName(channel)}${note}.` });
  } else {
    let status: AutomationOutcome = "FAILED";
    let summary = `Couldn't ${input.verb} ${input.who}: ${outcome.error}`;
    if (outcome.held) {
      status = "SKIPPED";
      summary = `Will ${input.verb} ${input.who} in the morning; it's outside the hours we message people.`;
    } else if (outcome.simulated) {
      status = "SKIPPED";
      summary = `Didn't ${input.verb} ${input.who}: ${notConnected.join(" and ")} isn't connected for ${tenant.name} yet.`;
    } else if (/consent/i.test(outcome.error ?? "")) {
      status = "SKIPPED";
      summary = `Didn't ${input.verb} ${input.who}: they haven't agreed to ${channelName(channel)} messages.`;
    } else if (/daily limit|already sent/i.test(outcome.error ?? "")) {
      status = "SKIPPED";
      summary = `Didn't ${input.verb} ${input.who}: ${outcome.error}`;
    }
    await repository.updateAutomationRun(tenant.id, run.id, { outcome: status, summary });
    if (status === "FAILED") {
      await repository.createException(tenant.id, { reason: summary, suggestedAction: "Reach them by hand, then check the messaging integration.", confidence: 0.9, contactId: input.contactId, leadId: input.leadId });
    }
  }
  return { ...outcome, runId: run.id, channel };
}

const skipped = (tenantId: string, typeKey: string, summary: string, ids: { contactId?: string | null; leadId?: string | null }) =>
  repository.recordAutomationRun(tenantId, { typeKey, outcome: "SKIPPED", summary, contactId: ids.contactId ?? null, leadId: ids.leadId ?? null });

// ---------------------------------------------------------------------------
// booking_lifecycle: confirm now, remind before, follow up after, auto-complete
// ---------------------------------------------------------------------------

export async function onBookingCreated(tenant: TenantSummary, lead: LeadRecord, bookingId: string, startsAt: Date | null, endsAt: Date | null, rescheduled = false) {
  const settings = await automationSettings(tenant.id, "booking_lifecycle");
  if (!settings) return;
  const booking = await repository.findBookingById(tenant.id, bookingId);
  const name = leadDisplayName(lead);
  const when = whenPhrase(tenant, startsAt);

  // Idempotent: a redelivered webhook never confirms twice.
  if (!booking?.confirmedAt || rescheduled) {
    await repository.updateBooking(tenant.id, bookingId, { confirmedAt: new Date() });
    await sendAndLog({ tenant, typeKey: "booking_lifecycle", recipient: lead, compose: (channel, signedBy) => templates.bookingConfirmation({ tenant, firstName: lead.firstName, when, channel, rescheduled, signedBy }), identity: await senderIdentity(tenant, lead.assigneeId), contactId: lead.contactId, leadId: lead.id, transactional: true, sent: `${rescheduled ? "Confirmed the new time of" : "Confirmed"} ${name}'s appointment${when ? ` ${when}` : ""}.`, who: name, verb: "confirm the appointment for" });
  }

  if (startsAt) {
    const now = Date.now();
    // Usual reminder time; for a near booking, a shorter notice as long as it still lands before the start.
    let reminderAt: Date | null = new Date(startsAt.getTime() - hours(num(settings, "reminderHoursBefore", 24)));
    if (reminderAt.getTime() <= now) {
      const fallback = new Date(Math.max(now + 10 * 60_000, startsAt.getTime() - hours(2)));
      reminderAt = fallback.getTime() < startsAt.getTime() ? fallback : null;
    }
    if (reminderAt) {
      reminderAt = clampOutOfQuietHours(tenant, reminderAt, startsAt);
      await schedule(tenant.id, { typeKey: "booking_lifecycle", action: "reminder", runAt: reminderAt, payload: { bookingId, leadId: lead.id }, dedupeKey: `booking:${bookingId}:reminder` });
    }
    const end = endsAt ?? new Date(startsAt.getTime() + hours(1));
    await schedule(tenant.id, { typeKey: "booking_lifecycle", action: "auto_complete", runAt: new Date(end.getTime() + hours(2)), payload: { bookingId, leadId: lead.id }, dedupeKey: `booking:${bookingId}:auto_complete` });
  }
}

/**
 * After an appointment. When a person marked it attended we follow up and (if
 * enabled) ask for a review. When it merely passed (`auto`), nobody knows
 * whether they came, so only a neutral follow-up goes out and no review ask.
 */
export async function onBookingCompleted(tenant: TenantSummary, lead: LeadRecord, bookingId: string, auto = false) {
  const lifecycle = await automationSettings(tenant.id, "booking_lifecycle");
  if (lifecycle) {
    const runAt = clampOutOfQuietHours(tenant, new Date(Date.now() + hours(num(lifecycle, "followUpHoursAfter", 24))), null);
    await schedule(tenant.id, { typeKey: "booking_lifecycle", action: "follow_up", runAt, payload: { bookingId, leadId: lead.id, uncertain: auto }, dedupeKey: `booking:${bookingId}:follow_up` });
  }
  const review = await automationSettings(tenant.id, "review_request");
  if (review && !auto) {
    await schedule(tenant.id, { typeKey: "review_request", action: "ask", runAt: new Date(Date.now() + hours(num(review, "delayHours", 3))), payload: { bookingId, leadId: lead.id, contactId: lead.contactId }, dedupeKey: `review:${lead.contactId ?? lead.id}:${bookingId}` });
  }
}

/**
 * A text or WhatsApp reply from a contact. Their latest live lead is touched
 * (so quiet-quote watching restarts), and the assigned person, or everyone
 * holding lead alerts when nobody is assigned, gets the words by email with
 * a link to the lead. Logged in "Handled for you" either way.
 */
export async function onContactReplied(tenant: TenantSummary, input: { contactId: string; conversationId: string; channel: "SMS" | "WHATSAPP"; messageId: string | null }) {
  const contact = await repository.findContactById(tenant.id, input.contactId);
  if (!contact) return;
  const messages = await repository.listMessages(tenant.id, input.conversationId, 20);
  const inbound = messages.filter((m) => m.direction === "INBOUND").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const message = (input.messageId ? inbound.find((m) => m.id === input.messageId) : null) ?? inbound[0] ?? null;
  const text = message?.body?.trim() || "(empty)";
  const lead = await repository.findLatestOpenLeadForContact(tenant.id, contact.id);
  if (lead) await repository.touchLead(tenant.id, lead.id, new Date());
  const who = leadDisplayName(contact);
  const everyone = await repository.listAlertRecipients(tenant.id);
  const recipients = lead?.assigneeId ? everyone.filter((r) => r.userId === lead.assigneeId) : everyone;
  const alert = recipients.length ? recipients : everyone;
  if (alert.length === 0) {
    await repository.recordAutomationRun(tenant.id, { typeKey: "enquiry_auto_reply", outcome: "ESCALATED", summary: `${who} replied by ${channelName(input.channel)}, but nobody at ${tenant.name} holds lead alerts yet.`, leadId: lead?.id ?? null, contactId: contact.id });
    return;
  }
  const portalUrl = `${(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/app/${tenant.slug}/leads`;
  const mail = templates.replyAlertEmail({ tenant, leadName: who, channel: input.channel, text, phone: contact.phone, portalUrl });
  const run = await repository.recordAutomationRun(tenant.id, { typeKey: "enquiry_auto_reply", outcome: "SENT", summary: `${who} replied by ${channelName(input.channel)}; told ${alert.length === 1 ? (alert[0].name ?? alert[0].email) : `${alert.length} people`}.`, leadId: lead?.id ?? null, contactId: contact.id, details: { conversationId: input.conversationId } });
  let reached = 0;
  for (const r of alert) {
    const sent = await sendMessage({ tenant, contactId: null, channel: "EMAIL", to: r.email, body: mail.body, subject: mail.subject, automationRunId: run.id, transactional: true });
    if (sent.ok) reached++;
  }
  if (reached === 0) await repository.updateAutomationRun(tenant.id, run.id, { outcome: "SKIPPED", summary: `${who} replied by ${channelName(input.channel)}; the alert couldn't be emailed (email isn't connected for ${tenant.name} yet), so check the inbox.` });
}

/**
 * Who hears about something a lead did: their assigned person when they have
 * one and that person holds lead alerts, otherwise everyone who does. Phones
 * come from member profiles; a person without one gets email only.
 */
async function peopleToTell(tenant: TenantSummary, assigneeId: string | null): Promise<{ recipients: { userId: string; email: string; name: string | null }[]; phones: Map<string, string> }> {
  const everyone = await repository.listAlertRecipients(tenant.id);
  const own = assigneeId ? everyone.filter((r) => r.userId === assigneeId) : [];
  const recipients = own.length ? own : everyone;
  const phones = new Map((await repository.listTenantPeople(tenant.id)).filter((p) => p.via === "member").map((p) => [p.userId, textableNumber(tenant, p.phone)] as const).filter((e): e is readonly [string, string] => e[1] !== null));
  return { recipients, phones };
}

export async function onCallbackRequested(tenant: TenantSummary, lead: LeadRecord, when: string | null) {
  const name = leadDisplayName(lead);
  const { recipients, phones } = await peopleToTell(tenant, lead.assigneeId);
  if (recipients.length === 0) return;
  const portalUrl = `${(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/app/${tenant.slug}/leads`;
  const text = templates.callbackRequestedSms({ tenant, leadName: name, when, phone: lead.phone });
  const mail = templates.callbackRequestedEmail({ tenant, leadName: name, when, phone: lead.phone, email: lead.email, portalUrl });
  const run = await repository.recordAutomationRun(tenant.id, { typeKey: "booking_lifecycle", outcome: "SENT", summary: `Told ${recipients.length === 1 ? (recipients[0].name ?? recipients[0].email) : `${recipients.length} people`} that ${name} wants a call back${when ? ` (${when.slice(0, 60)})` : ""}.`, leadId: lead.id, contactId: lead.contactId });
  let reached = 0;
  for (const r of recipients) {
    const phone = phones.get(r.userId);
    if (phone) {
      const buzz = await sendMessage({ tenant, contactId: null, channel: "SMS", to: phone, body: text, automationRunId: run.id, transactional: true });
      if (buzz.ok) reached++;
      else if (!buzz.simulated) console.error(`[automations] text to ${phone.slice(0, 4)}… for ${tenant.slug} failed: ${buzz.error}`);
    }
    const sent = await sendMessage({ tenant, contactId: null, channel: "EMAIL", to: r.email, body: mail.body, subject: mail.subject, automationRunId: run.id, transactional: true });
    if (sent.ok) reached++;
  }
  if (reached === 0) await repository.updateAutomationRun(tenant.id, run.id, { outcome: "SKIPPED", summary: `${name} wants a call back${when ? ` (${when.slice(0, 60)})` : ""}, but nobody could be told: messaging isn't connected for ${tenant.name} yet. It is in the queue.` });
}

/** A cancelled appointment reopens the booking window and offers another time. */
export async function onBookingCancelled(tenant: TenantSummary, lead: LeadRecord, bookingId: string) {
  await repository.unbookLead(tenant.id, lead.id, new Date(Date.now() + hours(tenant.sla.bookingWindowHours)));
  const settings = await automationSettings(tenant.id, "booking_lifecycle");
  if (!settings) return;
  const bookingUrl = await bookingLinkFor(tenant, lead);
  await sendAndLog({ tenant, typeKey: "booking_lifecycle", recipient: lead, compose: (channel, signedBy) => templates.bookingCancelled({ tenant, firstName: lead.firstName, bookingUrl, channel, signedBy }), identity: await senderIdentity(tenant, lead.assigneeId), contactId: lead.contactId, leadId: lead.id, transactional: true, sent: `Offered ${leadDisplayName(lead)} another time after they cancelled.`, who: leadDisplayName(lead), verb: "offer another time to" });
  void bookingId;
}

// ---------------------------------------------------------------------------
// reactivation and missed-call reply
// ---------------------------------------------------------------------------

export async function onContactLapsed(tenant: TenantSummary, contact: ContactRecord) {
  const settings = await automationSettings(tenant.id, "reactivation");
  if (!settings) return;
  const name = leadDisplayName(contact);
  const bookingUrl = await bookingLinkFor(tenant, { id: `contact_${contact.id}`, firstName: contact.firstName, lastName: contact.lastName, email: contact.email, phone: contact.phone });
  await sendAndLog({ tenant, typeKey: "reactivation", recipient: contact, compose: (channel) => templates.reactivation({ tenant, firstName: contact.firstName, bookingUrl, channel }), contactId: contact.id, leadId: null, transactional: false, sent: `Said hello to ${name} after a long quiet spell.`, who: name, verb: "message" });
}

export async function onMissedCall(tenant: TenantSummary, contact: ContactRecord): Promise<"sent" | "skipped" | "off"> {
  const settings = await automationSettings(tenant.id, "enquiry_auto_reply");
  if (!settings || settings.missedCallReply === false || !contact.phone) return "off";
  // One text per caller per day, however many times they ring.
  if ((await repository.countOutboundMessages(tenant.id, { since: new Date(Date.now() - 24 * 3_600_000), to: contact.phone })) > 0) return "skipped";
  const bookingUrl = await bookingLinkFor(tenant, { id: `contact_${contact.id}`, firstName: contact.firstName, lastName: contact.lastName, email: contact.email, phone: contact.phone });
  const name = leadDisplayName(contact);
  const result = await sendAndLog({ tenant, typeKey: "enquiry_auto_reply", recipient: { email: null, phone: contact.phone }, only: ["SMS", "WHATSAPP"], compose: () => ({ body: templates.missedCallSms({ tenant, firstName: contact.firstName, bookingUrl }) }), contactId: contact.id, leadId: null, transactional: true, sent: `Texted ${name} straight after their missed call with a booking link.`, who: name, verb: "text" });
  return result.ok ? "sent" : "skipped";
}

/**
 * The RED side of intake: an enquiry that needs no person (e.g. a renter asking
 * about availability). Replies only when the tenant has that reply switched
 * on, and logs honestly when nothing goes out.
 */
export async function onRedEnquiry(tenant: TenantSummary, lead: LeadRecord) {
  const name = leadDisplayName(lead);
  const settings = await automationSettings(tenant.id, "enquiry_auto_reply");
  const kind = typeof lead.attributes.property === "string" ? `question about ${lead.attributes.property}` : "enquiry";
  if (!settings || !settings.renterReply) {
    await skipped(tenant.id, "enquiry_auto_reply", `Filed ${name}'s ${kind}; no automatic reply is set up for this kind of enquiry.`, { leadId: lead.id, contactId: lead.contactId });
    return;
  }
  if (!lead.email && !lead.phone) {
    await skipped(tenant.id, "enquiry_auto_reply", `Filed ${name}'s ${kind}; they left no phone or email to reply to.`, { leadId: lead.id, contactId: lead.contactId });
    return;
  }
  // A known listing answers its own enquiry: its link (and a one-line description) beats a generic page.
  const text = `${lead.message ?? ""} ${typeof lead.attributes.property === "string" ? lead.attributes.property : ""}`;
  const listing = await findListingMentioned(tenant.id, text);
  // One mentioned area narrows the search; two or more ("I live in X and want a place in Y") means a generic reply.
  const areas = safeAreas(text, tenant.qualificationRules.serviceAreas);
  const area = areas.length === 1 ? areas[0]! : null;
  const needs = listingNeeds(text);
  const topic = needs.inspection ? "an inspection" : needs.rental ? "rentals" : null;
  // No single listing named, but a suburb or a bedroom count: offer what is available that fits.
  const matches = listing ? [] : await findListingsMatching(tenant.id, { suburb: area, bedrooms: needs.bedrooms, limit: 3 });
  const infoUrl = (listing && typeof listing.attributes.url === "string" ? listing.attributes.url : null) ?? (typeof settings.renterReplyUrl === "string" ? settings.renterReplyUrl : null);
  // The property's own manager takes the lead when the rent roll is unambiguous: the listing was named, or every
  // matching property has the same manager. Assignment is a fact about the lead; how messages are signed is separate.
  const managers = new Set((listing ? [listing] : matches).map((m) => (typeof m.attributes.manager === "string" ? m.attributes.manager.trim().toLowerCase() : null)).filter((m): m is string => Boolean(m)));
  const manager = managers.size === 1 ? [...managers][0]! : null;
  if (manager && !lead.assigneeId) {
    const person = (await repository.listTenantPeople(tenant.id)).find((p) => p.via === "member" && p.name?.trim().toLowerCase() === manager);
    if (person) {
      await repository.assignLead(tenant.id, lead.id, person.userId);
      lead = { ...lead, assigneeId: person.userId };
    }
  }
  const custom = typeof settings.redReplyText === "string" ? settings.redReplyText : listing ? `thanks for your message to ${tenant.name} about ${describeListing(listing, tenant.locale, tenant.currency)}.${infoUrl ? ` Details and inspection times are here: ${infoUrl}.` : ""} If your question is about something else, reply here and a person will pick it up.` : null;
  const listings = matches.map((m) => describeListing(m, tenant.locale, tenant.currency));
  const result = await sendAndLog({ tenant, typeKey: "enquiry_auto_reply", recipient: lead, compose: (channel, signedBy) => templates.generalReply({ tenant, firstName: lead.firstName, channel, custom, infoUrl, topic, area, listings, signedBy }), identity: await senderIdentity(tenant, lead.assigneeId), contactId: lead.contactId, leadId: lead.id, transactional: true, sent: `Answered ${name}'s ${kind} automatically${listing ? ` with the details for ${listing.name}` : matches.length ? ` with ${matches.length} matching ${matches.length === 1 ? "property" : "properties"}${area ? ` in ${area}` : ""}` : ""}. Nothing needed from you.`, who: name, verb: "reply to" });
  if (result.ok) await repository.markLeadResponded(tenant.id, lead.id, new Date());
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
    case "content_engine:batch": {
      await runContentBatch(tenant, new Date());
      return;
    }
    case "ads_sync:run": {
      await runAdsSync(tenant, new Date());
      return;
    }
    case "finance_sync:run": {
      await runFinanceSync(tenant, new Date());
      return;
    }
    case "website_analytics:rollup": {
      await rollupSite(tenant);
      return;
    }
    case "inventory_sync:run": {
      await runInventorySync(tenant, new Date());
      return;
    }
    case "social_sync:run": {
      await runSocialSync(tenant, new Date());
      return;
    }
    case "sla_watch:expire": {
      await expireStaleOpportunities(tenant, new Date());
      return;
    }
    case "weekly_digest:send": {
      await sendWeeklyDigest(tenant, new Date());
      return;
    }
    case "playbook:ensure": {
      // The safety net under the inline playbook: if the request that created the lead died before the playbook
      // logged anything, run it now. A lead with any auto-reply run already had its turn; never a second message.
      if (!lead || lead.ticketType !== "GREEN") return;
      if ((await repository.countAutomationRuns(tenant.id, { typeKey: "enquiry_auto_reply", leadId: lead.id })) > 0) return;
      log("warn", "playbook.ensure_ran", { tenantId: tenant.id, leadId: lead.id });
      await runGreenLeadPlaybook(tenant, lead);
      return;
    }
    case "meta_lead:fetch": {
      // A Facebook lead whose details could not be read when the webhook arrived. Throwing lets the tick retry and,
      // after three attempts, hand it to an operator as an exception.
      const ref = metaLeadRefFromPayload(action.payload);
      if (!ref) throw new NonRetryableError("meta_lead:fetch payload has no leadgen id");
      await ingestMetaLead(tenant, ref, { retryOnFailure: false });
      return;
    }
    case "messaging:release": {
      // A marketing message held during quiet hours. sendMessage re-checks consent and caps.
      const p = action.payload;
      const channel = p.channel as OutboundChannel;
      const contactId = typeof p.contactId === "string" ? p.contactId : null;
      const cta = p.cta && typeof p.cta === "object" && typeof (p.cta as { url?: unknown }).url === "string" ? (p.cta as MessageCta) : null;
      const signature = p.signature && typeof p.signature === "object" && typeof (p.signature as { name?: unknown }).name === "string" ? (p.signature as MessageSignature) : null;
      const result = await sendMessage({ tenant, contactId, channel, to: String(p.to), body: String(p.body), subject: typeof p.subject === "string" ? p.subject : undefined, automationRunId: typeof p.automationRunId === "string" ? p.automationRunId : null, transactional: false, replyTo: typeof p.replyTo === "string" ? p.replyTo : null, cta, signature });
      const contact = contactId ? await repository.findContactById(tenant.id, contactId) : null;
      const who = contact ? leadDisplayName(contact) : "a contact";
      if (result.ok) await repository.recordAutomationRun(tenant.id, { typeKey: "messaging", outcome: "SENT", summary: `Sent ${who} the message held overnight.`, contactId });
      else if (!result.held) await repository.recordAutomationRun(tenant.id, { typeKey: "messaging", outcome: result.simulated ? "SKIPPED" : "FAILED", summary: `Couldn't send ${who} the message held overnight: ${result.error}`, contactId });
      return;
    }
    case "booking_lifecycle:reminder": {
      const booking = await repository.findBookingById(tenant.id, String(action.payload.bookingId));
      if (!booking || !lead) return;
      const name = leadDisplayName(lead);
      if (booking.status !== "SCHEDULED") {
        await skipped(tenant.id, "booking_lifecycle", `Didn't remind ${name}: the appointment is no longer scheduled.`, { leadId: lead.id, contactId: lead.contactId });
        return;
      }
      if (booking.remindedAt) return;
      const when = whenPhrase(tenant, booking.startsAt);
      // Stamp before sending so a retry after a late failure never sends twice.
      await repository.updateBooking(tenant.id, booking.id, { remindedAt: new Date() });
      await sendAndLog({ tenant, typeKey: "booking_lifecycle", recipient: lead, compose: (channel, signedBy) => templates.bookingReminder({ tenant, firstName: lead.firstName, when, channel, signedBy }), identity: await senderIdentity(tenant, lead.assigneeId), contactId: lead.contactId, leadId: lead.id, transactional: true, sent: `Reminded ${name} about their appointment${when ? ` ${when}` : ""}.`, who: name, verb: "remind" });
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
      if (!booking || !lead || booking.status !== "COMPLETED" || booking.followedUpAt) return;
      const name = leadDisplayName(lead);
      await repository.updateBooking(tenant.id, booking.id, { followedUpAt: new Date() });
      await sendAndLog({ tenant, typeKey: "booking_lifecycle", recipient: lead, compose: (channel, signedBy) => templates.bookingFollowUp({ tenant, firstName: lead.firstName, channel, uncertain: action.payload.uncertain === true, signedBy }), identity: await senderIdentity(tenant, lead.assigneeId), contactId: lead.contactId, leadId: lead.id, transactional: true, sent: `Followed up with ${name} after their appointment.`, who: name, verb: "follow up with" });
      return;
    }
    case "review_request:ask": {
      const settings = await automationSettings(tenant.id, "review_request");
      if (!settings) return;
      const contactId = typeof action.payload.contactId === "string" ? action.payload.contactId : lead?.contactId ?? null;
      const contact = contactId ? await repository.findContactById(tenant.id, contactId) : null;
      if (!contact) return;
      const name = leadDisplayName(contact);
      const reviewUrl = typeof settings.reviewUrl === "string" ? settings.reviewUrl : null;
      if (!reviewUrl) {
        await skipped(tenant.id, "review_request", `Would have asked ${name} for a review, but no review link is set up for ${tenant.name}.`, { contactId: contact.id, leadId: lead?.id ?? null });
        return;
      }
      // One ask per person per quarter, however often they book or pay.
      const since = new Date(Date.now() - 90 * 86_400_000);
      if ((await repository.countAutomationRuns(tenant.id, { typeKey: "review_request", contactId: contact.id, outcome: "SENT", since })) > 0) return;
      // A review request is marketing: consent and quiet hours apply.
      await sendAndLog({ tenant, typeKey: "review_request", recipient: contact, compose: (channel) => templates.reviewRequest({ tenant, firstName: contact.firstName, reviewUrl, channel }), contactId: contact.id, leadId: lead?.id ?? null, transactional: false, sent: `Asked ${name} for a review.`, who: name, verb: "ask for a review from" });
      return;
    }
    case "chase_information:chase": {
      const settings = await automationSettings(tenant.id, "chase_information");
      const request = await repository.findInformationRequestById(tenant.id, String(action.payload.requestId));
      if (!settings || !request || request.status !== "OPEN") return;
      const contact = request.contactId ? await repository.findContactById(tenant.id, request.contactId) : null;
      const who = contact ? leadDisplayName(contact) : "A contact";
      const maxChases = num(settings, "maxChases", 3);
      if (request.chaseCount >= maxChases) {
        await repository.updateInformationRequest(tenant.id, request.id, { status: "ESCALATED" });
        await repository.createException(tenant.id, { reason: `${who} hasn't sent ${request.description} after ${request.chaseCount} reminders.`, suggestedAction: "Call them, or close the request if it no longer matters.", confidence: 0.7, contactId: request.contactId, leadId: request.leadId });
        await repository.recordAutomationRun(tenant.id, { typeKey: "chase_information", outcome: "ESCALATED", summary: `Stopped chasing ${who} for ${request.description} after ${request.chaseCount} reminders; we've asked a person to call them.`, contactId: request.contactId, leadId: request.leadId });
        return;
      }
      if (!contact) return;
      // Count the chase before sending so a retry cannot send it twice.
      await repository.updateInformationRequest(tenant.id, request.id, { chaseCount: request.chaseCount + 1, lastChasedAt: new Date() });
      await sendAndLog({ tenant, typeKey: "chase_information", recipient: contact, compose: (channel, signedBy) => templates.chase({ tenant, firstName: contact.firstName, what: request.description, channel, signedBy }), identity: await senderIdentity(tenant, request.leadId ? (await repository.findLeadById(tenant.id, request.leadId))?.assigneeId : null), contactId: contact.id, leadId: request.leadId, transactional: true, sent: `Reminded ${who} about ${request.description} (${request.chaseCount + 1} of ${maxChases}).`, who, verb: "remind" });
      await schedule(tenant.id, { typeKey: "chase_information", action: "chase", runAt: new Date(Date.now() + num(settings, "chaseEveryDays", 2) * 86_400_000), payload: { requestId: request.id }, dedupeKey: `request:${request.id}:chase:${request.chaseCount + 1}` });
      return;
    }
    default:
      throw new NonRetryableError(`No handler for ${action.typeKey}:${action.action}`);
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
  // Whatever brings a flagged person back (an enquiry, a reply, a booking, a payment) closes their open items as recovered.
  registerReconciler();
  // Completed appointments and payments move the lead along its pipeline.
  registerPipelineAdvancement();

  // A payment or a win is as good a moment to ask for a review as an attended appointment; one ask per person per quarter.
  const askForReview = async (tenantId: string, contactId: string | null, leadId: string | null, key: string) => {
    const tenant = await tenantById(tenantId);
    if (!tenant || !contactId) return;
    const review = await automationSettings(tenant.id, "review_request");
    if (!review) return;
    await schedule(tenant.id, { typeKey: "review_request", action: "ask", runAt: new Date(Date.now() + hours(num(review, "delayHours", 3))), payload: { leadId, contactId }, dedupeKey: `review:${contactId}:${key}` });
  };
  subscribe("invoice.paid", async (e) => {
    const contactId = typeof e.payload.contactId === "string" ? e.payload.contactId : null;
    const lead = contactId ? await repository.findLatestOpenLeadForContact(e.tenantId, contactId) : null;
    await askForReview(e.tenantId, contactId, lead?.id ?? null, `paid:${String(e.payload.invoiceId ?? e.id)}`);
  });
  subscribe("lead.won", async (e) => {
    const contactId = typeof e.payload.contactId === "string" ? e.payload.contactId : null;
    const leadId = typeof e.payload.leadId === "string" ? e.payload.leadId : null;
    await askForReview(e.tenantId, contactId, leadId, `won:${leadId ?? e.id}`);
  });

  // A lead who asks to be called back has told us exactly what they want. The person who should make the call hears
  // at once, by text and email; the operator queue already holds the item in case nobody does.
  subscribe("booking.callback_requested", async (e) => {
    const tenant = await tenantById(e.tenantId);
    const lead = tenant && typeof e.payload.leadId === "string" ? await repository.findLeadById(tenant.id, e.payload.leadId) : null;
    if (!tenant || !lead) return;
    await onCallbackRequested(tenant, lead, typeof e.payload.when === "string" && e.payload.when.trim() ? e.payload.when.trim() : null);
  });

  // A lead who texts back is talking to a person now: the assigned person (or everyone with lead alerts) is told at once,
  // with the words, and nothing automated answers them. The inbox watch raises it if nobody replies in time.
  subscribe("message.received", async (e) => {
    const channel = e.payload.channel === "WHATSAPP" ? "WHATSAPP" : e.payload.channel === "SMS" ? "SMS" : null;
    const contactId = typeof e.payload.contactId === "string" ? e.payload.contactId : null;
    const conversationId = typeof e.payload.conversationId === "string" ? e.payload.conversationId : null;
    if (!channel || !contactId || !conversationId) return;
    const tenant = await tenantById(e.tenantId);
    if (!tenant) return;
    await onContactReplied(tenant, { contactId, conversationId, channel, messageId: typeof e.payload.messageId === "string" ? e.payload.messageId : null });
  });

  subscribe("booking.created", async (e) => {
    const tenant = await tenantById(e.tenantId);
    const lead = tenant && typeof e.payload.leadId === "string" ? await repository.findLeadById(tenant.id, e.payload.leadId) : null;
    if (!tenant || !lead || typeof e.payload.bookingId !== "string") return;
    await onBookingCreated(tenant, lead, e.payload.bookingId, e.payload.startsAt ? new Date(String(e.payload.startsAt)) : null, e.payload.endsAt ? new Date(String(e.payload.endsAt)) : null, e.payload.rescheduled === true);
  });

  subscribe("booking.completed", async (e) => {
    const tenant = await tenantById(e.tenantId);
    const lead = tenant && typeof e.payload.leadId === "string" ? await repository.findLeadById(tenant.id, e.payload.leadId) : null;
    if (!tenant || !lead || typeof e.payload.bookingId !== "string") return;
    await onBookingCompleted(tenant, lead, e.payload.bookingId, e.payload.auto === true);
  });

  subscribe("booking.cancelled", async (e) => {
    const tenant = await tenantById(e.tenantId);
    const lead = tenant && typeof e.payload.leadId === "string" ? await repository.findLeadById(tenant.id, e.payload.leadId) : null;
    if (!tenant || !lead || typeof e.payload.bookingId !== "string") return;
    await onBookingCancelled(tenant, lead, e.payload.bookingId);
  });

  subscribe("missed_opportunity.detected", async (e) => {
    if (e.payload.type !== "LAPSED_CUSTOMER" || typeof e.payload.contactId !== "string") return;
    const tenant = await tenantById(e.tenantId);
    const contact = tenant ? await repository.findContactById(tenant.id, e.payload.contactId) : null;
    if (tenant && contact) await onContactLapsed(tenant, contact);
  });

  subscribe("lead.qualified", async (e) => {
    if (e.payload.ticketType !== "RED") return;
    const tenant = await repository.findTenantById(e.tenantId);
    const lead = tenant ? await repository.findLeadById(tenant.id, String(e.payload.leadId)) : null;
    if (tenant && lead) await onRedEnquiry(tenant, lead);
  });
}
