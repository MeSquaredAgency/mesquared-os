import { PLATFORM_LABEL } from "@/components/shell/platform";
import { repository } from "@/lib/data";
import { leadDisplayName } from "@/lib/leads";
import type { AutomationOutcome, ConversationRecord, LeadRecord, MissedOpportunityRecord, MissedOpportunityType, ReviewRecord } from "@/lib/types";
import { humanize } from "@/lib/utils";

/** One missed opportunity with everything behind it: who, where, what they said, and what we did. */
export interface OpportunityDetail {
  item: MissedOpportunityRecord;
  /** The summary, with the person's name where an older item says only "Someone". */
  headline: string;
  person: { name: string; email: string | null; phone: string | null } | null;
  /** Where it happened, e.g. "Instagram message", "Google review", "Phone call". */
  where: string | null;
  /** The thread for a message or comment, oldest first, our replies included. */
  messages: { from: "them" | "us"; body: string; at: Date }[];
  review: ReviewRecord | null;
  lead: LeadRecord | null;
  /** Still waiting on a reply in the inbox, so the page can send them there. */
  awaitingReply: boolean;
  suggestedAction: string | null;
  /** Each step we took, oldest first. */
  trail: { at: Date; outcome: AutomationOutcome; summary: string }[];
}

const THREAD_TYPES: ReadonlySet<MissedOpportunityType> = new Set<MissedOpportunityType>(["UNREPLIED_DM", "UNREPLIED_COMMENT"]);

/** The id after the type in a dedupe key: a conversation, review, booking, form session, lead or contact. */
export function subjectIdOf(dedupeKey: string): string {
  const i = dedupeKey.indexOf(":");
  return i < 0 ? "" : dedupeKey.slice(i + 1);
}

/** "Instagram message", "Facebook comment", "Text message"… */
export function conversationPlace(convo: Pick<ConversationRecord, "channel" | "platform">): string {
  if (convo.channel === "SMS") return "Text message";
  if (convo.channel === "WHATSAPP") return "WhatsApp";
  if (convo.channel === "EMAIL") return "Email";
  const platform = convo.platform ? PLATFORM_LABEL[convo.platform] : "Social";
  return `${platform} ${convo.channel === "SOCIAL_COMMENT" ? "comment" : "message"}`;
}

function placeFor(type: MissedOpportunityType, convo: ConversationRecord | null, review: ReviewRecord | null, lead: LeadRecord | null): string | null {
  if (convo) return conversationPlace(convo);
  if (review) return `${humanize(review.provider)} review`;
  if (type === "MISSED_CALL") return "Phone call";
  if (type === "ABANDONED_FORM") return "Website form";
  if (lead) return humanize(lead.source);
  return null;
}

/**
 * Loads one item for the portal. A member who sees only their own leads gets
 * only items on leads assigned to them, the same rule as the list, so a link
 * can't be used to read someone else's.
 */
export async function loadOpportunityDetail(tenantId: string, id: string, opts: { onlyAssigneeId: string | null }): Promise<OpportunityDetail | null> {
  const item = await repository.findMissedOpportunityById(tenantId, id);
  if (!item) return null;
  const lead = item.leadId ? await repository.findLeadById(tenantId, item.leadId) : null;
  if (opts.onlyAssigneeId && lead?.assigneeId !== opts.onlyAssigneeId) return null;

  const subjectId = subjectIdOf(item.dedupeKey);
  const [contact, convo, review, trail] = await Promise.all([
    item.contactId ? repository.findContactById(tenantId, item.contactId) : null,
    THREAD_TYPES.has(item.type) ? repository.findConversationById(tenantId, subjectId) : null,
    item.type === "UNANSWERED_REVIEW" ? repository.findReviewById(tenantId, subjectId) : null,
    repository.getMissedOpportunityTrail(tenantId, item.id),
  ]);
  const messages = convo ? await repository.listMessages(tenantId, convo.id, 20) : [];

  const who = contact ?? lead;
  const name = who ? leadDisplayName(who) : (convo?.displayName ?? review?.authorName ?? null);
  // Items raised before the detector used the platform's name for the sender say "Someone"; the thread knows better.
  const headline = name && item.summary.startsWith("Someone ") ? `${name} ${item.summary.slice("Someone ".length)}` : item.summary;

  return {
    item,
    headline,
    person: name ? { name, email: who?.email ?? null, phone: who?.phone ?? null } : null,
    where: placeFor(item.type, convo, review, lead),
    messages: messages.map((m) => ({ from: m.direction === "INBOUND" ? "them" : "us", body: m.body, at: m.createdAt })),
    review,
    lead,
    awaitingReply: convo?.awaitingReply ?? false,
    suggestedAction: trail.exception?.suggestedAction ?? null,
    trail: trail.runs.map((r) => ({ at: r.createdAt, outcome: r.outcome, summary: r.summary })),
  };
}
