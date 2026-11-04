import { PLATFORM_LABEL } from "@/components/shell/platform";
import { repository } from "@/lib/data";
import { normalizePhone, toE164 } from "@/lib/intake/schema";
import { leadDisplayName } from "@/lib/leads";
import { quoteUntrusted, safeName } from "@/lib/messaging/templates";
import { isCallFirst, type MissedOpportunityType, type TenantSummary } from "@/lib/types";
import { chaseUncalledLead } from "./call-first";
import { raiseMissedOpportunity } from "./raise";

export { opportunityValue } from "./raise";

export interface DetectionResult {
  tenantId: string;
  detected: { type: MissedOpportunityType; subjectId: string }[];
}

function agoPhrase(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return "less than an hour ago";
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

function setting<T>(settings: Record<string, unknown>, key: string, fallback: T): T {
  const v = settings[key];
  return (typeof v === typeof fallback ? (v as T) : fallback);
}

/**
 * Every detector from the spec, run against one tenant. Each is idempotent:
 * one open item per subject and type. Detection thresholds come from the
 * tenant's SLA and the sla_watch automation settings; values from
 * `opportunityValues`. Signals that need a channel the tenant has not
 * connected simply find nothing.
 */
export async function detectForTenant(tenant: TenantSummary, now = new Date()): Promise<DetectionResult> {
  const detected: DetectionResult["detected"] = [];
  const config = await repository.getTenantConfig(tenant.id);
  const watch = config.automations.find((a) => a.typeKey === "sla_watch");
  if (!watch?.enabled) return { tenantId: tenant.id, detected };
  const settings = watch.settings;
  const note = (type: MissedOpportunityType, subjectId: string) => detected.push({ type, subjectId });

  // 1 & 4. Unanswered enquiries and leads that never booked.
  const { respond, book } = await repository.listLeadsPastSla(tenant.id, now);
  const callFirst = isCallFirst(tenant);
  for (const lead of respond) {
    const r = await raiseMissedOpportunity(tenant, {
      type: "UNANSWERED_ENQUIRY",
      leadId: lead.id,
      contactId: lead.contactId,
      subjectId: lead.id,
      summary: callFirst ? `${leadDisplayName(lead)} was promised a call and has waited more than ${tenant.sla.firstResponseMinutes} minutes for it.` : `${leadDisplayName(lead)} has waited more than ${tenant.sla.firstResponseMinutes} minutes without a reply.`,
      suggestedAction: callFirst ? "Call them now, then mark them as called." : "Please call them now; the automatic reply didn't reach them.",
      fallbackValueCents: lead.valueCents,
    });
    if (r) note("UNANSWERED_ENQUIRY", lead.id);
    // Call-first: the people who should be calling hear about it on their phones, and are chased again if still nobody has.
    if (r && callFirst) await chaseUncalledLead(tenant, lead, { again: false, now });
  }
  // A lead nobody has replied to has not booked either; its value is already counted once, under the unanswered enquiry.
  const unanswered = new Set(respond.map((l) => l.id));
  for (const lead of book) {
    if (unanswered.has(lead.id)) continue;
    const r = await raiseMissedOpportunity(tenant, {
      type: "NOT_BOOKED",
      leadId: lead.id,
      contactId: lead.contactId,
      subjectId: lead.id,
      summary: `${leadDisplayName(lead)} was acknowledged but nothing was booked within ${tenant.sla.bookingWindowHours} hours.`,
      suggestedAction: "Call them directly and offer a time this week.",
      fallbackValueCents: lead.valueCents,
    });
    if (r) note("NOT_BOOKED", lead.id);
  }

  // 5. No-shows: recent bookings marked NO_SHOW. Older ones were raised when they happened (or are not worth chasing),
  // so a fixed window keeps the list short and stops closed items coming back week after week.
  const noShowDays = setting(settings, "noShowLookbackDays", 14);
  const noShows = await repository.listBookings(tenant.id, { status: ["NO_SHOW"], startsAfter: new Date(now.getTime() - noShowDays * 86_400_000), limit: 200 });
  const noShowLeads = new Map((await repository.findLeadsByIds(tenant.id, noShows.map((b) => b.leadId))).map((l) => [l.id, l]));
  for (const b of noShows) {
    const lead = noShowLeads.get(b.leadId);
    if (!lead) continue;
    const r = await raiseMissedOpportunity(tenant, {
      type: "NO_SHOW",
      leadId: lead.id,
      contactId: lead.contactId,
      subjectId: b.id,
      summary: `${leadDisplayName(lead)} didn't show for their appointment${b.startsAt ? ` on ${b.startsAt.toLocaleDateString(tenant.locale, { timeZone: tenant.timezone, day: "numeric", month: "short" })}` : ""}.`,
      suggestedAction: "Offer a new time. Most no-shows rebook if asked the same day.",
      fallbackValueCents: lead.valueCents,
    });
    if (r) note("NO_SHOW", b.id);
  }

  // 6. Quotes and proposals gone quiet.
  for (const { lead, stageName, quietDays } of await repository.listLeadsQuietInStage(tenant.id, now)) {
    const r = await raiseMissedOpportunity(tenant, {
      type: "QUIET_QUOTE",
      leadId: lead.id,
      contactId: lead.contactId,
      subjectId: lead.id,
      summary: `${leadDisplayName(lead)} has been silent for ${quietDays} days since "${stageName}".`,
      suggestedAction: "A short personal nudge usually restarts it: ask if anything is holding them back.",
      fallbackValueCents: lead.valueCents,
    });
    if (r) note("QUIET_QUOTE", lead.id);
  }

  // 7. Unreplied DMs, comments, and texts or WhatsApp messages a lead sent back to us.
  const inboxMinutes = setting(settings, "unrepliedInboxMinutes", 120);
  const inboxCutoff = new Date(now.getTime() - inboxMinutes * 60_000);
  for (const c of await repository.listConversationsAwaitingReply(tenant.id, { channels: ["SOCIAL_DM", "SOCIAL_COMMENT", "SMS", "WHATSAPP"], olderThan: inboxCutoff })) {
    const type: MissedOpportunityType = c.channel === "SOCIAL_COMMENT" ? "UNREPLIED_COMMENT" : "UNREPLIED_DM";
    const contact = c.contactId ? await repository.findContactById(tenant.id, c.contactId) : null;
    // Social threads have no contact record; the name the platform showed is what the inbox calls them too.
    const who = contact ? leadDisplayName(contact) : (safeName(c.displayName) ?? "Someone");
    const platform = c.platform ? ` on ${PLATFORM_LABEL[c.platform]}` : "";
    const r = await raiseMissedOpportunity(tenant, {
      type,
      leadId: null,
      contactId: c.contactId,
      subjectId: c.id,
      summary: `${who} sent a ${c.channel === "SOCIAL_COMMENT" ? "comment" : c.channel === "SMS" ? "text" : c.channel === "WHATSAPP" ? "WhatsApp message" : "message"}${platform} ${agoPhrase(now.getTime() - (c.lastMessageAt?.getTime() ?? now.getTime()))} and hasn't had a reply.`,
      suggestedAction: c.channel === "SMS" || c.channel === "WHATSAPP" ? "They answered one of our messages; call or text them back from your own phone." : "Reply from the inbox. Public comments are seen by everyone who visits the page.",
    });
    if (r) note(type, c.id);
  }

  // 8. Unanswered reviews.
  const reviewHours = setting(settings, "unansweredReviewHours", 48);
  const reviewCutoff = new Date(now.getTime() - reviewHours * 3_600_000);
  for (const rv of await repository.listReviews(tenant.id, { unansweredOnly: true, receivedBefore: reviewCutoff })) {
    const r = await raiseMissedOpportunity(tenant, {
      type: "UNANSWERED_REVIEW",
      leadId: null,
      contactId: null,
      subjectId: rv.id,
      summary: `A ${rv.rating ? `${rv.rating}-star ` : ""}${rv.provider} review${rv.authorName ? ` from ${rv.authorName}` : ""} has had no reply for ${Math.floor((now.getTime() - rv.receivedAt.getTime()) / 86_400_000)} days.`,
      suggestedAction: rv.rating !== null && rv.rating <= 3 ? "Reply calmly and take it offline; future customers read how you handle it." : "Thank them by name. A replied review ranks and converts better.",
    });
    if (r) note("UNANSWERED_REVIEW", rv.id);
  }

  // 9. Lapsed customers.
  const reactivation = config.automations.find((a) => a.typeKey === "reactivation");
  const inactiveDays = setting(reactivation?.settings ?? {}, "inactiveDays", 90);
  const inactiveBefore = new Date(now.getTime() - inactiveDays * 86_400_000);
  for (const contact of await repository.listLapsedCandidates(tenant.id, inactiveBefore)) {
    await repository.markContactLapsed(tenant.id, contact.id, now);
    const r = await raiseMissedOpportunity(tenant, {
      type: "LAPSED_CUSTOMER",
      leadId: null,
      contactId: contact.id,
      subjectId: contact.id,
      summary: `${leadDisplayName(contact)} hasn't been in touch for over ${inactiveDays} days.`,
      suggestedAction: reactivation?.enabled ? "If they've agreed to hear from you, a win-back message goes out automatically; follow up personally if there's no reply in a week." : "Reach out personally, or ask Me² to turn on win-back messages.",
      confidence: 0.6,
    });
    if (r) note("LAPSED_CUSTOMER", contact.id);
  }

  // 3. Abandoned forms (sessions idle 30 minutes with an email or phone captured).
  const idleBefore = new Date(now.getTime() - 30 * 60_000);
  for (const f of await repository.listAbandonedFormSessions(tenant.id, idleBefore)) {
    await repository.updateFormSession(tenant.id, f.sessionKey, { flaggedAt: now });
    const rawEmail = typeof f.partial.email === "string" ? f.partial.email.trim().toLowerCase() : null;
    const email = rawEmail && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(rawEmail) ? rawEmail : null;
    const phone = toE164(normalizePhone(typeof f.partial.phone === "string" ? f.partial.phone : null), tenant.region);
    if (!email && !phone) continue;
    const contact = await repository.upsertContact(tenant.id, { firstName: safeName(typeof f.partial.name === "string" ? f.partial.name : null), lastName: null, email, phone, company: null });
    let site: string | null = null;
    try {
      site = f.pageUrl ? new URL(f.pageUrl).host : null;
    } catch {}
    const r = await raiseMissedOpportunity(tenant, {
      type: "ABANDONED_FORM",
      leadId: null,
      contactId: contact.id,
      subjectId: f.id,
      summary: `${leadDisplayName(contact)} started the ${quoteUntrusted(f.formName ?? "contact", 40)} form${site ? ` on ${site}` : ""} and didn't finish.`,
      suggestedAction: "A gentle 'can we help?' message recovers a good share of these.",
      confidence: 0.4,
    });
    if (r) note("ABANDONED_FORM", f.id);
  }

  // 2. Missed calls arrive as events (see /api/v1/inbound/call) and are raised there.

  return { tenantId: tenant.id, detected };
}
