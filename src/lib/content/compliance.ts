import type { BrandProfileRecord, ComplianceIssue, ComplianceReport, SocialPlatform, TenantSummary } from "@/lib/types";
import { specFor } from "./platforms";

/**
 * The compliance block, enforced on every asset before anyone sees it.
 *
 * Three kinds of outcome:
 *   - block: the draft cannot be approved until fixed (banned phrase, hype,
 *     over the platform limit, two unrelated subjects combined where the
 *     tenant forbids it)
 *   - signoff: allowed, but only the client may approve (prices, named
 *     people, outcome claims, numbers that may be stale)
 *   - note: shown for context
 *
 * The required footer is applied, not merely checked: `applyFooter` appends
 * it when missing so no asset can leave without it.
 */

const HYPE = ["guaranteed", "guarantee", "best in", "#1", "number one", "once in a lifetime", "act now", "don't miss out", "dont miss out", "limited time", "unbelievable", "insane", "secret", "hack"];

/** Capitalised two-word names that are not the business, a place word, or a month: "Chloe Baptiste", "Graham Steele". */
const NAME_RE = /\b([A-Z][a-z]{2,})\s+([A-Z][a-z]{2,})\b/g;
const NAME_STOPWORDS = new Set(["January", "February", "March", "April", "June", "July", "August", "September", "October", "November", "December", "Street", "Road", "Avenue", "Parade", "Court", "Drive", "Lane", "Place", "Terrace", "North", "South", "East", "West", "Open", "Spring", "Summer", "Autumn", "Winter", "Google", "Facebook", "Instagram", "Business", "Profile", "Realty", "Group", "Health", "Fitness", "Property", "Management"]);
const PRICE_RE = /(\$|AUD|USD|€|£)\s?\d[\d,]*(\.\d+)?|\b\d[\d,]*\s?(dollars|per week|pw|p\/w|a week|per month|pcm)\b/i;
const PERCENT_RE = /\b\d{1,3}(\.\d+)?\s?%/;
const OUTCOME_RE = /\b(lost|lose|dropped|gained)\s+\d+\s?(kg|kilos|pounds|lbs|cm)\b|\b(doubled|tripled|cured|eliminates|guaranteed results|clinically proven)\b/i;
const YEAR_RE = /\b(19[89]\d|20[0-4]\d)\b/g;
const ADDRESS_RE = /\b\d{1,5}[A-Za-z]?(?:\/\d{1,5})?\s+[A-Z][a-z]+(?:\s[A-Z][a-z]+)?\s(?:Street|St|Road|Rd|Avenue|Ave|Parade|Pde|Court|Ct|Drive|Dr|Lane|Ln|Place|Pl|Terrace|Tce|Crescent|Cres|Way|Boulevard|Blvd)\b/g;

export interface ComplianceInput {
  text: string;
  platform: SocialPlatform | null;
  brand: BrandProfileRecord | null;
  tenant: Pick<TenantSummary, "name">;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function checkCompliance(input: ComplianceInput, now = new Date()): ComplianceReport {
  const issues: ComplianceIssue[] = [];
  const text = input.text;
  const lower = text.toLowerCase();
  const brand = input.brand;
  const block = brand?.complianceBlock ?? {};

  for (const phrase of brand?.bannedPhrases ?? []) {
    if (phrase && new RegExp(`(^|[^a-z])${escapeRe(phrase.toLowerCase())}([^a-z]|$)`, "i").test(lower)) issues.push({ code: "BANNED_PHRASE", message: `Uses a banned phrase: "${phrase}".`, severity: "block" });
  }
  for (const word of HYPE) {
    if (new RegExp(`(^|[^a-z#])${escapeRe(word)}([^a-z]|$)`, "i").test(lower)) issues.push({ code: "HYPE", message: `Reads as hype ("${word}"); the brand rules say no pressure language.`, severity: "block" });
  }

  const price = text.match(PRICE_RE);
  if (price) issues.push({ code: "PRICE", message: `Mentions a price (${price[0].trim()}): the client signs this off.`, severity: "signoff" });
  if (PERCENT_RE.test(text)) issues.push({ code: "CLAIM", message: "Quotes a percentage; figures must come from a record on file, so the client signs this off.", severity: "signoff" });
  if (OUTCOME_RE.test(text)) issues.push({ code: "CLAIM", message: "Makes an outcome claim; only the customer's own words, with consent, may carry one. Client sign-off required.", severity: "signoff" });

  const tenantWords = new Set(input.tenant.name.split(/\s+/));
  const names = new Set<string>();
  for (const m of text.matchAll(NAME_RE)) {
    const [, a, b] = m;
    if (NAME_STOPWORDS.has(a) || NAME_STOPWORDS.has(b) || tenantWords.has(a) || tenantWords.has(b)) continue;
    names.add(`${a} ${b}`);
  }
  if (names.size) issues.push({ code: "NAMED_PERSON", message: `Names ${Array.from(names).slice(0, 3).join(", ")}: the client confirms consent before this goes out.`, severity: "signoff" });

  const currentYear = now.getUTCFullYear();
  const staleYears = Array.from(text.matchAll(YEAR_RE)).map((m) => Number(m[1])).filter((y) => y < currentYear - 1);
  if (staleYears.length) issues.push({ code: "STALE_NUMBER", message: `Refers to ${staleYears[0]}; check the figure is still current.`, severity: "signoff" });

  const addresses = Array.from(new Set(Array.from(text.matchAll(ADDRESS_RE)).map((m) => m[0])));
  const forbidsCombining = (block.prohibitedCombinations ?? []).some((p) => /vendor|propert|client|customer/i.test(p));
  if (forbidsCombining && addresses.length > 1) issues.push({ code: "COMBINED_SUBJECTS", message: `Mentions ${addresses.length} different properties in one asset; this workspace never combines separate vendors.`, severity: "block" });

  if (input.platform) {
    const spec = specFor(input.platform);
    if (text.length > spec.maxChars) issues.push({ code: "TOO_LONG", message: `${text.length} characters; ${spec.label} drafts are capped at ${spec.maxChars}.`, severity: "block" });
  }
  const footer = block.requiredFooter?.trim();
  if (footer && !lower.includes(footer.toLowerCase())) issues.push({ code: "MISSING_FOOTER", message: `Missing the required footer "${footer}".`, severity: "block" });

  return {
    ok: !issues.some((i) => i.severity === "block"),
    needsClientSignoff: issues.some((i) => i.severity === "signoff"),
    issues,
    checkedAt: now.toISOString(),
  };
}

/** Appends the tenant's required footer when it is not already there. */
export function applyFooter(text: string, brand: BrandProfileRecord | null): string {
  const footer = brand?.complianceBlock.requiredFooter?.trim();
  if (!footer) return text;
  if (text.toLowerCase().includes(footer.toLowerCase())) return text;
  return `${text.trimEnd()}\n\n${footer}`;
}

/** One line a person can read: "Needs your sign-off: mentions a price" or "Ready". */
export function complianceSummary(report: ComplianceReport | undefined): string {
  if (!report) return "Not checked";
  const blocks = report.issues.filter((i) => i.severity === "block");
  if (blocks.length) return `Fix before approving: ${blocks.map((b) => b.message).join(" ")}`;
  const signoff = report.issues.filter((i) => i.severity === "signoff");
  if (signoff.length) return `Needs client sign-off: ${signoff.map((s) => s.message.split(":")[0].toLowerCase()).join("; ")}.`;
  return "Passed the brand and compliance checks.";
}
