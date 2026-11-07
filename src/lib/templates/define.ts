import type { OpportunityValues } from "@/lib/types";
import { genericTemplate } from "./generic";
import type { IndustryTemplate } from "./types";

type Settings = Record<string, unknown>;

/**
 * The general template's automations with changes: settings merge into an
 * existing automation, a new key switches that automation on, and `false`
 * leaves it off.
 */
export function automationsWith(changes: Record<string, Settings | false>): IndustryTemplate["automations"] {
  const out: IndustryTemplate["automations"] = [];
  for (const a of genericTemplate.automations) {
    const change = changes[a.key];
    if (change === false) continue;
    out.push(change ? { key: a.key, settings: { ...a.settings, ...change } } : a);
  }
  for (const [key, change] of Object.entries(changes)) {
    if (change !== false && !out.some((a) => a.key === key)) out.push(Object.keys(change).length ? { key, settings: change } : { key });
  }
  return out;
}

const round = (cents: number) => Math.max(5000, Math.round(cents / 1000) * 1000);

/**
 * What a slipped opportunity is worth, in cents, from three figures: a new
 * enquiry, a quote or proposal gone quiet, and a past customer who lapsed.
 * The smaller signals scale from the enquiry.
 */
export function valuesFrom({ enquiry, quote, lapsed }: { enquiry: number; quote: number; lapsed: number }): OpportunityValues {
  return {
    UNANSWERED_ENQUIRY: enquiry,
    MISSED_CALL: enquiry,
    ABANDONED_FORM: round(enquiry / 3),
    NOT_BOOKED: enquiry,
    NO_SHOW: enquiry,
    QUIET_QUOTE: quote,
    UNREPLIED_DM: round(enquiry / 3),
    UNREPLIED_COMMENT: round(enquiry / 20),
    UNANSWERED_REVIEW: round(enquiry / 6),
    LAPSED_CUSTOMER: lapsed,
  };
}

/** Posting slots: [day (0 Sunday), hour] pairs. */
export function contentModule(slots: [number, number][]): IndustryTemplate["modules"][number] {
  return { key: "content", settings: { postsPerWeek: slots.length, slots: slots.map(([day, hour]) => ({ day, hour })) } };
}
