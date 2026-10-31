import { normalizePhone, toE164 } from "@/lib/intake/schema";
import { TEMPLATE_BY_KEY } from "@/lib/templates";
import { TEAM_PERMISSIONS, type OnboardingAnswers, type TaskRow, type TeamRow, type ToolRow } from "@/lib/onboarding/form";
import { slugify } from "@/lib/tenants/provision";
import { REGION_PRESETS } from "@/lib/tenants/regions";
import type { TenantSettingsInput } from "@/lib/tenants/settings";
import { MISSED_OPPORTUNITY_TYPES, type MissedOpportunityType, type Permission } from "@/lib/types";

/**
 * Turns a client's onboarding answers into a draft workspace definition for
 * provisioning. The answers arrive one of two ways, both reduced to
 * QuestionnaireData first: the online form (`fromFormAnswers`) or the Claude
 * Docs questionnaire exported as Markdown (`fromMarkdown`).
 *
 * In the Markdown, questions are matched by the start of their wording (see
 * QUESTIONS), so a client can add rows, delete rows and type anything in the
 * answer cells.
 * Nothing is guessed silently: every answer that could not be read, and every
 * step the file cannot do (integrations, ad budgets, pipeline stages), lands
 * in `review` for the operator. The draft holds the client's contact details,
 * so it belongs in the git-ignored `tenants/` folder, never in source.
 */

export interface ParsedTable {
  section: string;
  header: string[];
  rows: string[][];
}

export interface ParsedQuestionnaire {
  /** Normalised question wording → the client's answer, from every two-column table. */
  answers: Map<string, string>;
  tables: ParsedTable[];
  checks: { section: string; label: string; checked: boolean }[];
}

/** One client's answers, whichever way they came in. */
export interface QuestionnaireData {
  values: Partial<Record<QuestionKey | "currency", string>>;
  /** Sender name and reply-to when they were given as separate answers (the online form). */
  sender?: { name?: string; email?: string };
  team: { name: string; title?: string; email?: string; mobile?: string; permissions: Permission[] }[];
  /** Where enquiries come from, with a rough monthly count when given. */
  channels: { channel: string; perMonth?: string }[];
  tools: { area: string; tool: string; access?: string }[];
  socialChannels: string[];
}

export interface TenantDefinitionDraft extends TenantSettingsInput {
  templateKey: string;
  name: string;
  slug?: string;
  region: string;
  timezone: string;
  locale: string;
  currency: string;
  fromName?: string;
  replyTo?: string;
  serviceAreas?: string[];
  requiredFooter?: string;
  signAsAssignee?: boolean;
  smsNumber?: string;
  website?: string;
  phone?: string;
  addresses?: string[];
  social?: { facebook?: string; instagram?: string; youtube?: string; linkedin?: string };
  people?: { email: string; name: string; role: string; title?: string; mobile?: string }[];
}

/** Stable keys for the questions the importer reads, matched on the start of their (normalised) wording. */
export const QUESTIONS = {
  businessName: "business name",
  legalName: "registered business name",
  businessType: "which best describes your business",
  serviceAreas: "areas you serve",
  addresses: "business addresses",
  timezone: "main time zone",
  phone: "main business phone number",
  links: "website and social media links",
  mainContact: "main contact",
  greenCriteria: "what makes an enquiry worth your personal time",
  highIntent: "which services or requests are worth the most",
  autoHandled: "which enquiries could we answer for you",
  requirePhone: "must someone give a phone number",
  firstResponse: "how quickly should a new enquiry get its first reply",
  bookingWindow: "how soon should a good lead be booked",
  quietHours: "hours when customers should not get automated",
  booking: "how do customers book with you today",
  stages: "the steps from first enquiry to paying customer",
  quoteQuiet: "after you send a quote or proposal",
  customerValue: "what is a typical new customer worth",
  reviewUrl: "your google review link",
  pastCustomers: "do you have past customers",
  inventory: "do you track anything customers ask about",
  escalateTo: "who should we tell when a good lead",
  signedBy: "should our messages to customers be signed",
  smsNumber: "would you like texts to customers to come from a dedicated",
  personality: "describe your brand's personality",
  voice: "how should we sound when we write as you",
  example: "example of an email or post",
  sender: "the name customers should see on our emails",
  banned: "words or phrases we must never use",
  claims: "claims we may only make with proof",
  footer: "a line that must appear on every ad",
  postsPerWeek: "how many posts a week",
  postingTimes: "best days and times to post",
  approvals: "who signs off posts",
  adBudget: "monthly ad budget per platform",
  consent: "how do customers agree to hear from you",
} as const;

export type QuestionKey = keyof typeof QUESTIONS;

// ---------------------------------------------------------------------------
// Markdown → tables, answers and checklists
// ---------------------------------------------------------------------------

export function normaliseText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\*\*|__/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitRow(line: string): string[] {
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\" && body[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (body[i] === "|") {
      cells.push(cur);
      cur = "";
    } else cur += body[i];
  }
  cells.push(cur);
  return cells.map((c) => c.replace(/<br\s*\/?>/gi, "\n").replace(/\*\*/g, "").trim());
}

const isDivider = (line: string) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line.trim());
const HEADER_WORDS = new Set(["question", "your answer"]);

export function parseQuestionnaire(markdown: string): ParsedQuestionnaire {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const answers = new Map<string, string>();
  const tables: ParsedTable[] = [];
  const checks: ParsedQuestionnaire["checks"] = [];
  let section = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const heading = /^#{1,3}\s+(?:\d+\.\s*)?(.+)$/.exec(line);
    if (heading) {
      section = normaliseText(heading[1]);
      continue;
    }
    const check = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/.exec(line);
    if (check) {
      checks.push({ section, label: check[2].trim(), checked: check[1].toLowerCase() === "x" });
      continue;
    }
    if (line.trim().startsWith("|") && i + 1 < lines.length && isDivider(lines[i + 1])) {
      const header = splitRow(line);
      const rows: string[][] = [];
      let j = i + 2;
      for (; j < lines.length && lines[j].trim().startsWith("|"); j++) rows.push(splitRow(lines[j]));
      tables.push({ section, header, rows });
      if (header.length === 2) {
        // Two-column tables are question → answer. The header row holds a pair too unless it is "Question | Your answer".
        const pairs = HEADER_WORDS.has(normaliseText(header[0])) ? rows : [header, ...rows];
        for (const [q, a = ""] of pairs) if (q && !answers.has(normaliseText(q))) answers.set(normaliseText(q), a.trim());
      }
      i = j - 1;
    }
  }
  return { answers, tables, checks };
}

export function answerFor(parsed: ParsedQuestionnaire, key: QuestionKey): string | undefined {
  const prefix = QUESTIONS[key];
  for (const [q, a] of parsed.answers) if (q.startsWith(prefix)) return a || undefined;
  return undefined;
}

// ---------------------------------------------------------------------------
// Readers for the free-text answers people actually write
// ---------------------------------------------------------------------------

/** Splits on new lines, semicolons and bullets when the answer uses them, otherwise on commas outside brackets. */
export function splitList(s: string | undefined): string[] {
  if (!s) return [];
  return s
    .split(/[\n;•]/.test(s) ? /[\n;•]/ : /,(?![^(]*\))/)
    .map((x) => x.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}

const NUM = String.raw`(\d+(?:\.\d+)?)`;

/** "5", "5 minutes", "under 10 min", "1 hour", "1.5 hrs" → minutes. The smaller end of a range wins. */
export function parseMinutes(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = new RegExp(`${NUM}\\s*(?:-|–|to)?\\s*(?:\\d+(?:\\.\\d+)?)?\\s*(minutes?|mins?|m\\b|hours?|hrs?|h\\b)?`, "i").exec(s);
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = (m[2] ?? "minutes").toLowerCase();
  const minutes = unit.startsWith("h") ? n * 60 : n;
  return minutes >= 1 && minutes <= 1440 ? Math.round(minutes) : undefined;
}

/** "48 hours", "2 days", "24h", "1 week", "same day" → hours. A bare number is read as hours. */
export function parseHours(s: string | undefined): number | undefined {
  if (!s) return undefined;
  if (/same[- ]day/i.test(s)) return 8;
  if (/next[- ]day|within a day/i.test(s)) return 24;
  const m = new RegExp(`${NUM}\\s*(?:-|–|to)?\\s*(?:\\d+(?:\\.\\d+)?)?\\s*(?:business |working )?(hours?|hrs?|h\\b|days?|d\\b|weeks?|wks?)?`, "i").exec(s);
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = (m[2] ?? "hours").toLowerCase();
  const hours = unit.startsWith("w") ? n * 168 : unit.startsWith("d") ? n * 24 : n;
  return hours >= 1 && hours <= 720 ? Math.round(hours) : undefined;
}

function clockHour(raw: string, meridiem: string | undefined): number | undefined {
  let h = Number(raw);
  if (!Number.isInteger(h) || h > 24) return undefined;
  const mer = meridiem?.toLowerCase();
  if (mer === "pm" && h < 12) h += 12;
  if (mer === "am" && h === 12) h = 0;
  return h % 24;
}

/** "8pm to 8am", "20:00-08:00", "9 pm – 7 am" → { start: 20, end: 8 }. */
export function parseQuietHours(s: string | undefined): { start: number; end: number } | undefined {
  if (!s) return undefined;
  const m = /(\d{1,2})(?::\d{2})?\s*(am|pm)?\s*(?:-|–|—|to|until|till)\s*(\d{1,2})(?::\d{2})?\s*(am|pm)?/i.exec(s);
  if (!m) return undefined;
  // "8 to 8am": a missing first meridiem is the evening when the second is morning.
  const firstMer = m[2] ?? (m[4]?.toLowerCase() === "am" ? "pm" : undefined);
  const start = clockHour(m[1], firstMer);
  const end = clockHour(m[3], m[4]);
  return start !== undefined && end !== undefined && start !== end ? { start, end } : undefined;
}

/** "$1,800", "1800 AUD", "$1.5k", "about $2,000 - $3,000" → the first amount in whole units. */
export function parseMoney(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = /(\d[\d,]*(?:\.\d+)?)\s*(k|thousand|m|million)?\b/i.exec(s);
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, ""));
  const mult = m[2] ? (/^m/i.test(m[2]) ? 1_000_000 : 1000) : 1;
  return Number.isFinite(n) ? n * mult : undefined;
}

const DAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/** "Mon 9am, Wed 5pm, Saturday 8am" → posting slots (day 0–6 from Sunday, hour 0–23). */
export function parseSlots(s: string | undefined): { day: number; hour: number }[] {
  if (!s) return [];
  const out: { day: number; hour: number }[] = [];
  const re = /\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?\s*(?:at\s*)?(\d{1,2})(?::\d{2})?\s*(am|pm)?/gi;
  for (const m of s.matchAll(re)) {
    const hour = clockHour(m[2], m[3]);
    if (hour !== undefined) out.push({ day: DAYS[m[1].toLowerCase()], hour });
  }
  return out;
}

export function parseYesNo(s: string | undefined): boolean | undefined {
  if (!s) return undefined;
  if (/^\s*(yes|y|yep|yeah|always|required|must)\b/i.test(s)) return true;
  if (/^\s*(no|n|nope|never|not required|optional)\b/i.test(s)) return false;
  return undefined;
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const EMAIL_ALL = new RegExp(EMAIL.source, "gi");
const URL_RE = /\bhttps?:\/\/[^\s|)>\]]+|\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|au|nz|uk|sg|biz|info|app)(?:\.[a-z]{2})?(?:\/[^\s|)>\]]*)?/gi;
const PHONE = /\+?\d[\d\s()-]{6,}\d/;

export function extractEmail(s: string | undefined): string | undefined {
  return s ? EMAIL.exec(s)?.[0].toLowerCase() : undefined;
}

export function extractUrls(s: string | undefined): string[] {
  if (!s) return [];
  return [...s.replace(EMAIL_ALL, " ").matchAll(URL_RE)].map((m) => m[0].replace(/[.,;]+$/, ""));
}

export function extractPhone(s: string | undefined): string | undefined {
  return s ? PHONE.exec(s)?.[0].trim() : undefined;
}

/** A REGION_PRESETS entry from what the client wrote about their time zone. */
export function presetFor(s: string | undefined): (typeof REGION_PRESETS)[number] | undefined {
  if (!s) return undefined;
  const exact = REGION_PRESETS.find((p) => p.timezone.toLowerCase() === s.trim().toLowerCase());
  if (exact) return exact;
  const t = s.toLowerCase();
  const by = (tz: string) => REGION_PRESETS.find((p) => p.timezone === tz);
  if (/adelaide|south australia|\bsa\b|acst|acdt|darwin/.test(t)) return by("Australia/Adelaide");
  if (/brisbane|queensland|\bqld\b|gold coast|sunshine coast/.test(t)) return by("Australia/Brisbane");
  if (/perth|western australia|\bwa\b|awst/.test(t)) return by("Australia/Perth");
  if (/sydney|melbourne|canberra|hobart|nsw|victoria|\bvic\b|\bact\b|tasmania|aest|aedt/.test(t)) return by("Australia/Sydney");
  if (/new zealand|auckland|wellington|christchurch|\bnz\b|nzst|nzdt/.test(t)) return by("Pacific/Auckland");
  if (/london|united kingdom|\buk\b|england|scotland|wales|gmt|bst/.test(t)) return by("Europe/London");
  if (/los angeles|san francisco|seattle|pacific|pst|pdt|california/.test(t)) return by("America/Los_Angeles");
  if (/new york|eastern|\best\b|\bedt\b|boston|miami/.test(t)) return by("America/New_York");
  if (/cambodia|phnom penh/.test(t)) return by("Asia/Phnom_Penh");
  if (/singapore/.test(t)) return by("Asia/Singapore");
  return undefined;
}

const CURRENCIES = ["AUD", "NZD", "GBP", "USD", "SGD", "EUR", "CAD"];

// ---------------------------------------------------------------------------
// The draft definition
// ---------------------------------------------------------------------------

function templateKeyFor(type: string | undefined): string | undefined {
  const t = normaliseText(type ?? "");
  if (t.startsWith("real estate")) return "real_estate";
  if (t.startsWith("health")) return "health_fitness";
  if (t.startsWith("other")) return "generic";
  return undefined;
}

/** Team-table columns in the Markdown questionnaire, by the start of their header. */
const PERMISSION_COLUMNS: { prefix: string; permission: Permission }[] = [
  { prefix: "new-lead alerts", permission: "RECEIVE_LEAD_ALERTS" },
  { prefix: "approves", permission: "APPROVE_CONTENT" },
  { prefix: "sees money", permission: "VIEW_FINANCES" },
  { prefix: "adds or removes", permission: "MANAGE_USERS" },
  { prefix: "sees every customer", permission: "VIEW_ALL_RECORDS" },
];

/** The template role that gives exactly the ticked permissions, else the smallest role that covers them. */
export function roleFor(templateKey: string, wanted: Permission[]): { key: string; name: string; exact: boolean } {
  const roles = TEMPLATE_BY_KEY[templateKey]?.roles ?? TEMPLATE_BY_KEY.generic.roles;
  const set = new Set(wanted);
  const exact = roles.find((r) => r.permissions.length === set.size && r.permissions.every((p) => set.has(p)));
  if (exact) return { key: exact.key, name: exact.name, exact: true };
  const covering = roles.filter((r) => wanted.every((p) => r.permissions.includes(p))).sort((a, b) => a.permissions.length - b.permissions.length)[0];
  const role = covering ?? roles[0];
  return { key: role.key, name: role.name, exact: false };
}

/** Lead-type opportunities take the customer's value; the minor ones keep the template's ratio to "not booked". */
function opportunityValuesFor(templateKey: string, customerValue: number): Partial<Record<MissedOpportunityType, number>> {
  const template = TEMPLATE_BY_KEY[templateKey] ?? TEMPLATE_BY_KEY.generic;
  const anchor = template.opportunityValues.NOT_BOOKED ?? 0;
  const full: MissedOpportunityType[] = ["UNANSWERED_ENQUIRY", "MISSED_CALL", "NOT_BOOKED", "NO_SHOW", "QUIET_QUOTE", "LAPSED_CUSTOMER"];
  const out: Partial<Record<MissedOpportunityType, number>> = {};
  for (const type of MISSED_OPPORTUNITY_TYPES) {
    if (full.includes(type)) out[type] = Math.round(customerValue);
    else if (anchor > 0) out[type] = Math.round(((template.opportunityValues[type] ?? 0) / anchor) * customerValue);
  }
  return out;
}

const isNone = (s: string | undefined) => Boolean(s && /^\s*(no|none|nope|not really|n\/a|na)\b/i.test(s));

/** The exported doc: question rows, the team, channel and systems tables, and the channel checklist. */
export function fromMarkdown(parsed: ParsedQuestionnaire): QuestionnaireData {
  const values: QuestionnaireData["values"] = {};
  for (const key of Object.keys(QUESTIONS) as QuestionKey[]) {
    const answer = answerFor(parsed, key);
    if (answer) values[key] = answer;
  }
  const team: QuestionnaireData["team"] = [];
  const teamTable = parsed.tables.find((t) => t.header.some((h) => normaliseText(h).startsWith("new-lead alerts")));
  if (teamTable) {
    const col = (prefix: string) => teamTable.header.findIndex((h) => normaliseText(h).startsWith(prefix));
    for (const row of teamTable.rows) {
      const name = row[col("name")]?.trim() ?? "";
      const emailCell = row[col("email")]?.trim() ?? "";
      if (!name && !emailCell) continue;
      const titleCell = row[col("job title")] ?? "";
      const mobile = extractPhone(titleCell);
      const title = titleCell.replace(PHONE, "").replace(/[,;/|]+\s*$/, "").replace(/^\s*[,;/|]+/, "").trim();
      team.push({ name, email: extractEmail(emailCell) ?? extractEmail(row.join(" ")), ...(title ? { title } : {}), ...(mobile ? { mobile } : {}), permissions: PERMISSION_COLUMNS.filter((c) => parseYesNo(row[col(c.prefix)]) === true).map((c) => c.permission) });
    }
  }
  const channelTable = parsed.tables.find((t) => normaliseText(t.header[0] ?? "") === "channel");
  const channels = (channelTable?.rows ?? []).filter((r) => r[0] && (r[1] ?? "").trim() && !isNone(r[1])).map((r) => ({ channel: r[0].trim(), perMonth: r[1].trim() }));
  const systems = parsed.tables.find((t) => normaliseText(t.header[0] ?? "") === "area");
  const tools = (systems?.rows ?? []).filter((r) => (r[1] ?? "").trim()).map((r) => ({ area: r[0]?.trim() ?? "", tool: r[1].trim(), access: r[3]?.trim() || undefined }));
  const socialChannels = parsed.checks.filter((c) => c.section.startsWith("content, social") && c.checked).map((c) => c.label);
  return { values, team, channels, tools, socialChannels };
}

const text = (answers: OnboardingAnswers, key: string) => {
  const v = answers[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
};
const list = (answers: OnboardingAnswers, key: string) => (Array.isArray(answers[key]) ? (answers[key] as string[]) : []);
const DAY_SHORT: Record<string, string> = { Monday: "Mon", Tuesday: "Tue", Wednesday: "Wed", Thursday: "Thu", Friday: "Fri", Saturday: "Sat", Sunday: "Sun" };

/** The online form (src/lib/onboarding/form.ts): structured answers, composed into the same wording the readers take. */
export function fromFormAnswers(answers: OnboardingAnswers): QuestionnaireData {
  const values: QuestionnaireData["values"] = {};
  const set = (key: QuestionKey | "currency", value: string | undefined) => {
    if (value && value.trim()) values[key] = value.trim();
  };
  for (const key of ["businessName", "legalName", "businessType", "serviceAreas", "addresses", "timezone", "currency", "phone", "greenCriteria", "highIntent", "autoHandled", "requirePhone", "firstResponse", "bookingWindow", "booking", "stages", "quoteQuiet", "customerValue", "reviewUrl", "pastCustomers", "escalateTo", "signedBy", "personality", "voice", "example", "banned", "claims", "footer", "postsPerWeek", "approvals", "consent"] as const) set(key, text(answers, key));
  set("links", ["website", "facebook", "instagram", "linkedin", "youtube"].map((k) => text(answers, k)).filter(Boolean).join(" "));
  set("mainContact", ["contactName", "contactRole", "contactEmail", "contactMobile"].map((k) => text(answers, k)).filter(Boolean).join(", "));
  const quietFrom = text(answers, "quietFrom");
  const quietTo = text(answers, "quietTo");
  if (quietFrom && quietTo) set("quietHours", `${quietFrom}-${quietTo}`);
  const inventory = text(answers, "inventory");
  set("inventory", inventory === "Yes" && text(answers, "inventoryWhere") ? `Yes, ${text(answers, "inventoryWhere")}` : inventory);
  const sms = text(answers, "smsChoice");
  set("smsNumber", sms === "existing" ? `Yes, ${text(answers, "smsExisting") ?? ""}` : sms === "new" ? "Yes, please set up a new number" : sms === "none" ? "No" : undefined);
  const days = list(answers, "postingDays").map((d) => DAY_SHORT[d]).filter(Boolean);
  const time = text(answers, "postingTime");
  if (days.length && time) set("postingTimes", days.map((d) => `${d} ${time}`).join(", "));
  const budgets = [["Meta", text(answers, "adMeta")], ["Google", text(answers, "adGoogle")]].filter(([, v]) => v).map(([k, v]) => `${k} $${v}`);
  if (budgets.length) set("adBudget", budgets.join(", "));

  const team = (Array.isArray(answers.team) ? (answers.team as TeamRow[]) : [])
    .filter((r) => r.name.trim() || r.email.trim())
    .map((r) => ({ name: r.name.trim(), title: r.title.trim() || undefined, email: extractEmail(r.email), mobile: r.mobile.trim() || undefined, permissions: TEAM_PERMISSIONS.filter((p) => r[p.key]).map((p) => p.permission) }));
  const channelRows = (answers.channels ?? {}) as Record<string, string>;
  const toolRows = (answers.tools ?? {}) as Record<string, ToolRow>;
  return {
    values,
    sender: { name: text(answers, "senderName"), email: text(answers, "replyTo") },
    team,
    channels: Object.entries(channelRows).map(([channel, perMonth]) => ({ channel, perMonth: perMonth.trim() || undefined })),
    tools: Object.entries(toolRows).filter(([, r]) => r.tool.trim()).map(([area, r]) => ({ area, tool: r.tool.trim(), access: r.access || undefined })),
    socialChannels: list(answers, "socialChannels"),
  };
}

/** Lines for the console about the back-office tasks the client would hand over, from the online form. */
export function handOverSummary(answers: OnboardingAnswers): string[] {
  const tasks = (answers.tasks ?? {}) as Record<string, TaskRow>;
  return Object.entries(tasks).filter(([, t]) => t.hand === "Yes" || t.hand === "Maybe").map(([task, t]) => `${task}${t.hours ? ` (${t.hours} h/week)` : ""}: ${t.hand === "Yes" ? "hand over" : "maybe"}`);
}

export function draftTenantDefinition(input: QuestionnaireData | ParsedQuestionnaire): { definition: TenantDefinitionDraft; review: string[] } {
  const data = "answers" in input ? fromMarkdown(input) : input;
  const review: string[] = [];
  const a = (key: QuestionKey | "currency") => data.values[key]?.trim() || undefined;

  // Workspace basics.
  const tradingName = a("businessName") ?? splitList(a("legalName"))[0];
  if (!tradingName) review.push("No business name: set \"name\" before provisioning.");
  const templateKey = templateKeyFor(a("businessType")) ?? "generic";
  if (!templateKeyFor(a("businessType"))) review.push(`Business type not chosen; drafted on the generic template. Pick real_estate, health_fitness or generic.`);
  const preset = presetFor(a("timezone")) ?? presetFor(a("addresses")) ?? REGION_PRESETS[0];
  if (!presetFor(a("timezone")) && !presetFor(a("addresses"))) review.push(`Time zone not recognised ("${a("timezone") ?? "blank"}"); drafted as ${preset.label}. Check region, timezone, locale and currency.`);
  const currency = CURRENCIES.find((c) => new RegExp(`\\b${c}\\b`, "i").test(a("currency") ?? a("timezone") ?? "")) ?? preset.currency;

  const definition: TenantDefinitionDraft = { templateKey, name: tradingName ?? "", slug: tradingName ? slugify(tradingName) : undefined, region: preset.region, timezone: preset.timezone, locale: preset.locale, currency };

  // Contact details for the email signature.
  const areas = splitList(a("serviceAreas"));
  if (areas.length) definition.serviceAreas = areas;
  const addresses = (a("addresses") ?? "").split(/\n|;/).map((x) => x.trim()).filter(Boolean);
  if (addresses.length) definition.addresses = addresses;
  if (a("phone")) definition.phone = a("phone");
  const social: NonNullable<TenantDefinitionDraft["social"]> = {};
  for (const url of extractUrls(a("links"))) {
    const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    if (/facebook\.com/i.test(url)) social.facebook ??= full;
    else if (/instagram\.com/i.test(url)) social.instagram ??= full;
    else if (/youtube\.com|youtu\.be/i.test(url)) social.youtube ??= full;
    else if (/linkedin\.com/i.test(url)) social.linkedin ??= full;
    else if (!/tiktok\.com|x\.com|twitter\.com/i.test(url)) definition.website ??= url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
  }
  if (Object.keys(social).length) definition.social = social;

  // Sender identity and compliance.
  const sender = a("sender");
  const replyTo = data.sender ? extractEmail(data.sender.email) : extractEmail(sender);
  if (replyTo) definition.replyTo = replyTo;
  // In the doc the name is whatever comes before the first separator, the email or "replies".
  const fromName = data.sender ? data.sender.name?.trim() : sender?.split(/[,;\n(]|\s[-–—]\s|\breplies\b|\breply\b/i)[0].replace(EMAIL_ALL, "").replace(/\s+(and|to)\s*$/i, "").trim();
  if (fromName) definition.fromName = fromName;
  if (sender && (!replyTo || !fromName)) review.push(`Sender answer "${sender}" did not give both a name and an email: check fromName and replyTo.`);
  if (data.sender && data.sender.email && !replyTo) review.push(`Reply-to "${data.sender.email}" is not an email address: check replyTo.`);
  if (a("footer")) definition.requiredFooter = a("footer");
  else if (templateKey === "real_estate") review.push("No compliance line given. Real estate needs the licence line on every asset (launch readiness requires it).");
  const signedBy = normaliseText(a("signedBy") ?? "");
  if (signedBy.startsWith("the team member")) definition.signAsAssignee = true;
  else if (signedBy.startsWith("the business")) definition.signAsAssignee = false;

  // People and roles, from the team list.
  const people: NonNullable<TenantDefinitionDraft["people"]> = [];
  for (const member of data.team) {
    if (!member.email) {
      review.push(`Team member "${member.name}" has no email address, so no sign-in was drafted for them.`);
      continue;
    }
    if (people.some((p) => p.email === member.email)) {
      review.push(`${member.email} is listed twice; kept the first.`);
      continue;
    }
    const role = roleFor(templateKey, member.permissions);
    if (!role.exact) review.push(`${member.name || member.email} ticked ${member.permissions.length ? member.permissions.join(", ") : "nothing"}; no ${TEMPLATE_BY_KEY[templateKey]?.name ?? "template"} role matches exactly, so they get "${role.name}". Check under Settings → People.`);
    people.push({ email: member.email, name: member.name || member.email, role: role.key, ...(member.title ? { title: member.title } : {}), ...(member.mobile ? { mobile: member.mobile } : {}) });
  }
  if (!people.length) {
    const contact = a("mainContact");
    const email = extractEmail(contact);
    if (email) {
      const owner = roleFor(templateKey, ["VIEW_FINANCES", "APPROVE_CONTENT", "RECEIVE_LEAD_ALERTS", "MANAGE_USERS", "VIEW_ALL_RECORDS"]);
      const name = contact!.split(/[,;]/)[0].trim();
      people.push({ email, name: name && !EMAIL.test(name) ? name : email, role: owner.key, ...(extractPhone(contact) ? { mobile: extractPhone(contact) } : {}) });
      review.push(`The team list is empty; the main contact (${email}) is drafted as "${owner.name}". Add the rest of the team before launch.`);
    } else review.push("No team members with an email address. Launch readiness needs someone who receives lead alerts.");
  }
  if (people.length) definition.people = people;
  const alertRoles = new Set((TEMPLATE_BY_KEY[templateKey]?.roles ?? []).filter((r) => r.permissions.includes("RECEIVE_LEAD_ALERTS")).map((r) => r.key));
  if (people.length && !people.some((p) => alertRoles.has(p.role))) review.push("Nobody gets new-lead alerts. Launch readiness requires at least one person who does.");

  // Service levels.
  const sla: NonNullable<TenantSettingsInput["sla"]> = {};
  const first = parseMinutes(a("firstResponse"));
  if (first) sla.firstResponseMinutes = first;
  else if (a("firstResponse")) review.push(`First-reply time "${a("firstResponse")}" is not a number of minutes; the template's value stays.`);
  const window = parseHours(a("bookingWindow"));
  if (window) sla.bookingWindowHours = window;
  else if (a("bookingWindow")) review.push(`Booking window "${a("bookingWindow")}" is not a number of hours or days; the template's value stays.`);
  if (a("bookingWindow") && /^\s*\d+(\.\d+)?\s*$/.test(a("bookingWindow")!)) review.push(`Booking window "${a("bookingWindow")}" has no unit; read as hours.`);
  const quiet = parseQuietHours(a("quietHours"));
  if (quiet) sla.quietHours = quiet;
  else if (a("quietHours")) review.push(`Quiet hours "${a("quietHours")}" could not be read; the region's default applies.`);
  if (Object.keys(sla).length) definition.sla = sla;

  // Qualification.
  const qualification: NonNullable<TenantSettingsInput["qualification"]> = {};
  if (splitList(a("greenCriteria")).length) qualification.greenCriteria = splitList(a("greenCriteria"));
  if (splitList(a("highIntent")).length) qualification.highIntentServices = splitList(a("highIntent"));
  if (splitList(a("autoHandled")).length) qualification.autoHandled = splitList(a("autoHandled"));
  const phoneRequired = parseYesNo(a("requirePhone"));
  if (phoneRequired !== undefined) qualification.requirePhone = phoneRequired;
  if (Object.keys(qualification).length) definition.qualification = qualification;

  // Brand.
  const brand: NonNullable<TenantSettingsInput["brand"]> = {};
  const voice = [a("voice"), a("personality") ? `Personality: ${a("personality")}.` : undefined].filter(Boolean).join(" ").slice(0, 500);
  if (voice) brand.voice = voice;
  if (a("example")) brand.examples = [a("example")!];
  if (splitList(a("banned")).length) brand.bannedPhrases = splitList(a("banned"));
  if (a("claims")) brand.claimsPolicy = `Only state these with proof on file: ${a("claims")}`.slice(0, 500);
  if (Object.keys(brand).length) definition.brand = brand;

  // Money at risk.
  const value = parseMoney(a("customerValue"));
  if (value) {
    definition.opportunityValues = opportunityValuesFor(templateKey, value);
    review.push(`Missed-opportunity values come from a customer worth ${value} ${currency}: enquiries, calls, no-shows, quiet quotes and lapsed customers take that value, the smaller items keep the template's proportions. Adjust under Settings → Escalation & values.`);
  } else if (a("customerValue")) review.push(`Customer value "${a("customerValue")}" has no amount; the template's values stay.`);

  // Content rhythm and reviews.
  const content: NonNullable<TenantSettingsInput["content"]> = {};
  const posts = parseMoney(a("postsPerWeek"));
  if (posts && posts >= 1 && posts <= 28) content.postsPerWeek = Math.round(posts);
  const slots = parseSlots(a("postingTimes"));
  if (slots.length) content.slots = slots;
  else if (a("postingTimes")) review.push(`Posting times "${a("postingTimes")}" need days and times (e.g. "Mon 9am, Thu 5pm"); the template's slots stay.`);
  if (Object.keys(content).length) definition.content = content;
  const reviewLink = extractUrls(a("reviewUrl"))[0];
  if (reviewLink) definition.reviewUrl = /^https?:\/\//i.test(reviewLink) ? reviewLink : `https://${reviewLink}`;
  else if (a("reviewUrl")) review.push(`No review link in "${a("reviewUrl")}"; review requests stay paused until reviewUrl is set.`);

  // Escalation: the named person hears about leads that did not book and quotes gone quiet.
  const escalateTo = a("escalateTo");
  if (escalateTo) {
    const byEmail = extractEmail(escalateTo);
    const firstName = (p: { name: string }) => normaliseText(p.name.split(" ")[0]).replace(/[^a-z'-]/g, "");
    const byName = people.find((p) => p.email === byEmail) ?? people.find((p) => firstName(p).length > 1 && new RegExp(`\\b${firstName(p)}\\b`).test(normaliseText(escalateTo)));
    if (byName) definition.escalation = [{ when: "NOT_BOOKED", email: byName.email }, { when: "QUIET_QUOTE", email: byName.email }];
    else review.push(`Escalation names "${escalateTo}", who is not in the team list; add them, then set escalation.`);
  }

  // The workspace's own SMS number.
  const sms = normalizePhone(extractPhone(a("smsNumber")));
  if (sms && parseYesNo(a("smsNumber")) !== false) {
    definition.smsNumber = toE164(sms, preset.region) ?? sms;
    review.push(`SMS number ${definition.smsNumber} comes from the client's answer; confirm it is a number Twilio can send from before provisioning.`);
  } else review.push("No SMS number given. Buy or port one in Twilio and add \"smsNumber\" so texts and STOP replies work.");

  // Switch-offs the client asked for.
  const switchOff: NonNullable<TenantSettingsInput["switchOff"]> = {};
  if (isNone(a("pastCustomers"))) switchOff.automations = ["reactivation"];
  if (isNone(a("inventory")) && TEMPLATE_BY_KEY[templateKey]?.modules.some((m) => m.key === "inventory")) switchOff.modules = ["inventory"];
  if (switchOff.automations || switchOff.modules) definition.switchOff = switchOff;

  // What the file cannot do: left for the operator, in the order of the onboarding runbook.
  if (a("stages")) review.push(`Sales steps from the client: "${a("stages")}". Compare with the ${TEMPLATE_BY_KEY[templateKey]?.name ?? ""} pipeline stages.`);
  const quoteDays = parseMoney(a("quoteQuiet"));
  if (quoteDays) review.push(`Follow up quotes after ${quoteDays} quiet days: set quietAfterDays on the quote or agreement stage.`);
  if (a("booking")) review.push(`Bookings today: "${a("booking")}". Connect Cal.com over that calendar (recommended readiness item).`);
  const activeChannels = data.channels.map((c) => `${c.channel.replace(/\s*\(.*\)$/, "")}${c.perMonth ? ` (${c.perMonth}/month)` : ""}`);
  if (activeChannels.length) review.push(`Set up intake for: ${activeChannels.join("; ")}. Issue an intake key for website forms.`);
  const tools = data.tools.map((t) => `${t.tool}${normaliseText(t.access ?? "") === "yes" ? "" : ` (access: ${t.access || "not answered"})`}`);
  if (tools.length) review.push(`Tools to connect where MeSquared OS has a connector: ${tools.join("; ")}.`);
  if (data.socialChannels.length) review.push(`Connect social channels: ${data.socialChannels.join(", ")} (npm run tenant:connect-meta for Facebook and Instagram).`);
  if (a("adBudget")) review.push(`Ad budgets: "${a("adBudget")}". Set each connected ad account's monthly budget.`);
  if (a("approvals")) review.push(`Posts with prices, people or results are signed off by: "${a("approvals")}". Make sure they have "Approves posts and ads".`);
  if (a("consent")) review.push(`Consent today: "${a("consent")}". Record it before switching on reactivation.`);

  return { definition, review };
}
