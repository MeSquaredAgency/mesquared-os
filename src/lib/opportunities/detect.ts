import { repository } from "@/lib/data";
import { leadDisplayName } from "@/lib/leads";
import type { MissedOpportunityType, TenantSummary } from "@/lib/types";
import { raiseMissedOpportunity } from "./raise";

export { opportunityValue } from "./raise";

export interface DetectionResult {
  tenantId: string;
  detected: { type: MissedOpportunityType; subjectId: string }[];
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
  for (const lead of respond) {
    const r = await raiseMissedOpportunity(tenant, {
      type: "UNANSWERED_ENQUIRY",
      leadId: lead.id,
      contactId: lead.contactId,
      subjectId: lead.id,
      summary: `${leadDisplayName(lead)} has waited more than ${tenant.sla.firstResponseMinutes} minutes without a reply.`,
      suggestedAction: "Reply now, then check why the automated acknowledgement didn't go out.",
      fallbackValueCents: lead.valueCents,
    });
    if (r) note("UNANSWERED_ENQUIRY", lead.id);
  }
  for (const lead of book) {
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

  // 5. No-shows: bookings marked NO_SHOW that have not been followed up.
  for (const b of await repository.listBookings(tenant.id, { status: ["NO_SHOW"], limit: 200 })) {
    const lead = await repository.findLeadById(tenant.id, b.leadId);
    if (!lead) continue;
    const r = await raiseMissedOpportunity(tenant, {
      type: "NO_SHOW",
      leadId: lead.id,
      contactId: lead.contactId,
      subjectId: b.id,
      summary: `${leadDisplayName(lead)} didn't show for their appointment${b.startsAt ? ` on ${b.startsAt.toLocaleDateString("en-AU", { timeZone: tenant.timezone, day: "numeric", month: "short" })}` : ""}.`,
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

  // 7. Unreplied DMs and comments.
  const inboxMinutes = setting(settings, "unrepliedInboxMinutes", 120);
  const inboxCutoff = new Date(now.getTime() - inboxMinutes * 60_000);
  for (const c of await repository.listConversationsAwaitingReply(tenant.id, { channels: ["SOCIAL_DM", "SOCIAL_COMMENT"], olderThan: inboxCutoff })) {
    const type: MissedOpportunityType = c.channel === "SOCIAL_DM" ? "UNREPLIED_DM" : "UNREPLIED_COMMENT";
    const contact = c.contactId ? await repository.findContactById(tenant.id, c.contactId) : null;
    const who = contact ? leadDisplayName(contact) : "Someone";
    const r = await raiseMissedOpportunity(tenant, {
      type,
      leadId: null,
      contactId: c.contactId,
      subjectId: c.id,
      summary: `${who} sent a ${c.channel === "SOCIAL_DM" ? "message" : "comment"} ${Math.round((now.getTime() - (c.lastMessageAt?.getTime() ?? now.getTime())) / 3_600_000)} hours ago and hasn't had a reply.`,
      suggestedAction: "Reply from the inbox. Public comments are seen by everyone who visits the page.",
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
      suggestedAction: reactivation?.enabled ? "A reactivation message has been sent; follow up personally if there's no reply in a week." : "Switch on the reactivation automation, or reach out personally.",
      confidence: 0.6,
    });
    if (r) note("LAPSED_CUSTOMER", contact.id);
  }

  // 3. Abandoned forms (sessions idle 30 minutes with an email or phone captured).
  const idleBefore = new Date(now.getTime() - 30 * 60_000);
  for (const f of await repository.listAbandonedFormSessions(tenant.id, idleBefore)) {
    await repository.updateFormSession(tenant.id, f.sessionKey, { flaggedAt: now });
    const email = typeof f.partial.email === "string" ? f.partial.email : null;
    const phone = typeof f.partial.phone === "string" ? f.partial.phone : null;
    const contact = await repository.upsertContact(tenant.id, { firstName: typeof f.partial.name === "string" ? f.partial.name.split(" ")[0] : null, lastName: null, email, phone, company: null });
    const r = await raiseMissedOpportunity(tenant, {
      type: "ABANDONED_FORM",
      leadId: null,
      contactId: contact.id,
      subjectId: f.id,
      summary: `${leadDisplayName(contact)} started the ${f.formName ?? "contact"} form${f.pageUrl ? ` on ${f.pageUrl}` : ""} and didn't finish.`,
      suggestedAction: "A gentle 'can we help?' message recovers a good share of these.",
      confidence: 0.4,
    });
    if (r) note("ABANDONED_FORM", f.id);
  }

  // 2. Missed calls arrive as events (see /api/v1/inbound/call) and are raised there.

  return { tenantId: tenant.id, detected };
}
