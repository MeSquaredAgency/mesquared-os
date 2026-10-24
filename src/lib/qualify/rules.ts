import type { QualificationRules } from "@/lib/types";
import type { QualificationInput, QualificationResult, Qualifier } from "./types";

/** Intent scores at or above this are GREEN. */
export const GREEN_THRESHOLD = 60;

/**
 * Deterministic, rule-based classifier.
 *
 * This is the stub used for local testing and as the fallback when no LLM
 * provider is configured. It is intentionally transparent: every point it
 * awards is recorded as a signal so operators can see why a lead landed
 * where it did.
 */

const DEFAULT_GREEN_KEYWORDS = [
  "book",
  "booking",
  "appointment",
  "consultation",
  "quote",
  "pricing",
  "price",
  "buy",
  "purchase",
  "order",
  "in stock",
  "available",
  "ready to",
  "asap",
  "urgent",
  "this week",
  "deposit",
  "retainer",
  "hire",
  "start",
];

const DEFAULT_RED_KEYWORDS = [
  "invoice",
  "receipt",
  "unsubscribe",
  "complaint",
  "refund",
  "cancel",
  "job",
  "career",
  "vacancy",
  "partnership",
  "sponsor",
  "guest post",
  "seo services",
  "backlink",
  "newsletter",
  "survey",
  "feedback",
  "password",
  "login",
  "support",
];

const HIGH_INTENT_SOURCES = new Set(["META_LEAD_FORM", "TIKTOK_LEAD_FORM", "LINKEDIN_LEAD_FORM", "PHONE", "REFERRAL"]);

function uniqueLower(values: string[]) {
  return Array.from(new Set(values.map((v) => v.trim().toLowerCase()).filter(Boolean)));
}

const matcherCache = new Map<string, RegExp>();

/** Words that carry no topic on their own in a tenant's "auto handled" list. */
const TOPIC_STOPWORDS = new Set(["and", "or", "the", "a", "an", "of", "for", "to", "enquiry", "enquiries", "question", "questions", "request", "requests", "application", "applications", "email", "emails", "message", "messages"]);

/** Topic stems of a phrase like "availability questions" → ["availab"], so "available" and "availability" both match. */
export function stemsOf(phrase: string): string[] {
  return phrase
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 5 && !TOPIC_STOPWORDS.has(w))
    .map((w) => w.slice(0, 6));
}

/** Whole-word prefix match: stem "inspect" hits "inspection" and "inspections", never "disinspect". */
function containsStem(body: string, stem: string): boolean {
  const key = `stem:${stem}`;
  let re = matcherCache.get(key);
  if (!re) {
    const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}`, "iu");
    matcherCache.set(key, re);
  }
  return re.test(body);
}

/** Whole-word match so "order" does not hit "border" and "job" does not hit "Jobson". */
function containsKeyword(body: string, keyword: string): boolean {
  let re = matcherCache.get(keyword);
  if (!re) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "iu");
    matcherCache.set(keyword, re);
  }
  return re.test(body);
}

function text(input: QualificationInput) {
  const attrs = Object.values(input.attributes ?? {})
    .filter((v) => typeof v === "string")
    .join(" ");
  return `${input.message ?? ""} ${attrs}`.toLowerCase();
}

/**
 * Reads a budget from common field names. Strings may carry currency symbols,
 * thousands separators, "k" suffixes or ranges ("500-1000" → 500, the lower
 * bound, so a range never inflates the score).
 */
export function parseBudget(attributes: Record<string, unknown>): number | null {
  const candidates = ["budget", "budget_range", "spend", "amount", "value"];
  for (const key of candidates) {
    const v = attributes[key];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
    if (typeof v === "string") {
      const m = /(\d[\d,\.]*)\s*(k)?/i.exec(v);
      if (!m) continue;
      const n = Number.parseFloat(m[1].replace(/,/g, ""));
      if (Number.isFinite(n) && n > 0) return m[2] ? n * 1000 : n;
    }
  }
  return null;
}

function parseTimeline(attributes: Record<string, unknown>): "now" | "soon" | "later" | null {
  const v = attributes["timeline"] ?? attributes["timeframe"] ?? attributes["when"];
  if (typeof v !== "string") return null;
  const s = v.toLowerCase();
  if (/(immediate|asap|now|this week|today|urgent)/.test(s)) return "now";
  if (/(month|weeks|soon|quarter)/.test(s)) return "soon";
  if (/(year|someday|research|just looking|browsing|not sure)/.test(s)) return "later";
  return null;
}

export function scoreLead(input: QualificationInput, rules: QualificationRules): QualificationResult {
  const signals: string[] = [];
  let score = 35; // neutral starting point: an unknown lead is a mild red until proven green

  const body = text(input);
  const green = uniqueLower([...DEFAULT_GREEN_KEYWORDS, ...(rules.greenKeywords ?? [])]);
  const red = uniqueLower([...DEFAULT_RED_KEYWORDS, ...(rules.redKeywords ?? [])]);

  const greenHits = green.filter((k) => k && containsKeyword(body, k));
  const redHits = red.filter((k) => k && containsKeyword(body, k));

  if (greenHits.length) {
    const pts = Math.min(30, greenHits.length * 10);
    score += pts;
    signals.push(`green keywords: ${greenHits.slice(0, 4).join(", ")} (+${pts})`);
  }
  if (redHits.length) {
    const pts = Math.min(35, redHits.length * 15);
    score -= pts;
    signals.push(`red keywords: ${redHits.slice(0, 4).join(", ")} (-${pts})`);
  }

  const services = (rules.highIntentServices ?? []).map((s) => s.toLowerCase());
  const serviceHits = services.filter((s) => s && containsKeyword(body, s));
  if (serviceHits.length) {
    score += 15;
    signals.push(`high-intent service: ${serviceHits.join(", ")} (+15)`);
  }

  const budget = parseBudget(input.attributes ?? {});
  if (budget !== null) {
    if (rules.minBudget !== undefined && budget >= rules.minBudget) {
      score += 20;
      signals.push(`budget ${budget} ≥ tenant minimum ${rules.minBudget} (+20)`);
    } else if (rules.minBudget !== undefined) {
      score -= 10;
      signals.push(`budget ${budget} below tenant minimum ${rules.minBudget} (-10)`);
    } else {
      score += 10;
      signals.push(`budget stated: ${budget} (+10)`);
    }
  }

  const timeline = parseTimeline(input.attributes ?? {});
  if (timeline === "now") {
    score += 15;
    signals.push("timeline: immediate (+15)");
  } else if (timeline === "soon") {
    score += 5;
    signals.push("timeline: soon (+5)");
  } else if (timeline === "later") {
    score -= 10;
    signals.push("timeline: later / researching (-10)");
  }

  if (input.phone) {
    score += 10;
    signals.push("phone number provided (+10)");
  } else if (rules.requirePhone) {
    score -= 15;
    signals.push("no phone number, which this business requires for a green lead (-15)");
  }

  const areas = (rules.serviceAreas ?? []).map((a) => a.toLowerCase()).filter(Boolean);
  if (areas.length) {
    const inArea = areas.filter((a) => containsKeyword(body, a));
    if (inArea.length) {
      score += 10;
      signals.push(`in service area: ${inArea.join(", ")} (+10)`);
    }
  }

  const autoHandled = (rules.autoHandled ?? []).map((a) => a.toLowerCase());
  const autoHits = autoHandled.filter((a) => stemsOf(a).some((stem) => containsStem(body, stem)));
  if (autoHits.length) {
    score -= 20;
    signals.push(`handled automatically for this business: ${autoHits[0]} (-20)`);
  }
  if (HIGH_INTENT_SOURCES.has(input.source)) {
    score += 5;
    signals.push(`source ${input.source} (+5)`);
  }
  if (!input.email && !input.phone) {
    score -= 20;
    signals.push("no contact details (-20)");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const ticketType = score >= GREEN_THRESHOLD ? "GREEN" : "RED";
  const reason =
    ticketType === "GREEN"
      ? `Revenue intent detected (score ${score}). ${signals.join("; ")}`
      : `Routed to operational queue (score ${score}). ${signals.join("; ") || "No intent signals found."}`;

  return { ticketType, intentScore: score, reason, classifier: "stub", signals };
}

export const ruleBasedQualifier: Qualifier = {
  name: "stub",
  async qualify(input, rules) {
    return scoreLead(input, rules);
  },
};
