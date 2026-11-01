import type { AutomationOutcome } from "@/lib/types";

/**
 * What the portal calls "handled for you": work that reached a customer or
 * finished a job without the client. Skipped, failed and escalated runs are
 * not handled (escalations show under Needs you), and neither is housekeeping
 * the client never sees, such as pulling data in from a connected platform.
 */
export const HANDLED_OUTCOMES: readonly AutomationOutcome[] = ["SENT", "COMPLETED"];

/** Background jobs that keep the workspace current; logged, but not work done for the client. */
export const HOUSEKEEPING_TYPES: readonly string[] = ["social_sync", "ads_sync", "finance_sync", "inventory_sync", "website_analytics", "messaging", "weekly_digest"];

export function countsAsHandled(run: { typeKey: string; outcome: AutomationOutcome }): boolean {
  return HANDLED_OUTCOMES.includes(run.outcome) && !HOUSEKEEPING_TYPES.includes(run.typeKey);
}

const PHRASES: Record<string, (n: number) => string> = {
  enquiry_auto_reply: (n) => `replied to ${n} ${n === 1 ? "enquiry" : "enquiries"}`,
  booking_lifecycle: (n) => `sent ${n} booking ${n === 1 ? "confirmation or reminder" : "confirmations and reminders"}`,
  chase_information: (n) => `chased ${n} outstanding ${n === 1 ? "request" : "requests"}`,
  review_request: (n) => `asked ${n} ${n === 1 ? "customer" : "customers"} for a review`,
  payment_reminders: (n) => `sent ${n} invoice ${n === 1 ? "reminder" : "reminders"}`,
  inbox_triage: (n) => `answered ${n} ${n === 1 ? "message" : "messages"}`,
  reactivation: (n) => `reached out to ${n} past ${n === 1 ? "customer" : "customers"}`,
  sla_watch: (n) => `won back ${n} ${n === 1 ? "lead" : "leads"} that ${n === 1 ? "was" : "were"} slipping`,
  content_engine: (n) => `drafted posts from ${n} ${n === 1 ? "idea" : "ideas"}`,
  social_publish: (n) => `published ${n} ${n === 1 ? "post" : "posts"}`,
};

/**
 * "replied to 14 enquiries, sent 3 booking confirmations and reminders and
 * asked 2 customers for a review": what was done, biggest first, at most
 * `limit` kinds, to follow "This week we". Null when nothing was handled.
 */
export function describeHandled(byType: { typeKey: string; count: number }[], limit = 3): string | null {
  const parts = byType
    .filter((t) => t.count > 0 && PHRASES[t.typeKey])
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((t) => PHRASES[t.typeKey](t.count));
  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
