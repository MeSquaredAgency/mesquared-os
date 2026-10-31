import { REGION_PRESETS } from "@/lib/tenants/regions";
import type { Permission } from "@/lib/types";

/**
 * The client onboarding form: the single definition the client's page renders,
 * the server validates against, and the workspace draft is built from. No
 * server imports: the client component uses it too.
 *
 * Wording is client-facing. It never says "tenant", "green" or "red", and it
 * asks for best guesses: almost every field is optional.
 */

export type Choice = "" | "Yes" | "Maybe" | "No";

export interface TeamRow {
  name: string;
  title: string;
  email: string;
  mobile: string;
  alerts: boolean;
  approves: boolean;
  finances: boolean;
  users: boolean;
  allRecords: boolean;
}

export interface TaskRow {
  hours: string;
  hand: Choice;
}

export interface ToolRow {
  tool: string;
  access: Choice;
}

export type AnswerValue = string | string[] | TeamRow[] | Record<string, string> | Record<string, TaskRow> | Record<string, ToolRow>;
export type OnboardingAnswers = Record<string, AnswerValue>;

interface Base {
  key: string;
  label: string;
  hint?: string;
  required?: boolean;
  /** How a required field is named mid-sentence ("Still needed: your email and …"). */
  short?: string;
  /** Shown only when another answer is one of these values. */
  showIf?: { key: string; in: string[] };
}

export type Field =
  | (Base & { kind: "text" | "email" | "tel" | "url" | "number" | "date"; placeholder?: string; maxLength?: number })
  | (Base & { kind: "textarea"; placeholder?: string; maxLength?: number })
  | (Base & { kind: "select" | "choice"; options: { value: string; label: string }[]; placeholder?: string })
  | (Base & { kind: "checks"; options: string[] })
  | (Base & { kind: "confirm" })
  | (Base & { kind: "team" })
  | (Base & { kind: "teamSelect" })
  | (Base & { kind: "channels"; options: string[] })
  | (Base & { kind: "tasks"; options: string[] })
  | (Base & { kind: "tools"; options: { area: string; placeholder: string }[] });

export interface Step {
  id: string;
  title: string;
  intro: string;
  fields: Field[];
}

const opts = (...values: string[]) => values.map((v) => ({ value: v, label: v }));
const YES_NO = opts("Yes", "No");

export const TEAM_PERMISSIONS: { key: keyof Pick<TeamRow, "alerts" | "approves" | "finances" | "users" | "allRecords">; label: string; hint: string; permission: Permission }[] = [
  { key: "alerts", label: "New-lead alerts", hint: "Hears about each new enquiry worth their time", permission: "RECEIVE_LEAD_ALERTS" },
  { key: "approves", label: "Approves posts and ads", hint: "Signs off content before it goes out", permission: "APPROVE_CONTENT" },
  { key: "finances", label: "Sees money and invoices", hint: "Revenue, spend and what is owed", permission: "VIEW_FINANCES" },
  { key: "users", label: "Adds or removes people", hint: "Manages who can sign in", permission: "MANAGE_USERS" },
  { key: "allRecords", label: "Sees every customer", hint: "Otherwise only the customers assigned to them", permission: "VIEW_ALL_RECORDS" },
];

export const SOCIAL_CHANNELS = ["Facebook", "Instagram", "TikTok", "YouTube (including Shorts)", "LinkedIn", "Google Business Profile"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const STEPS: Step[] = [
  {
    id: "business",
    title: "Your business",
    intro: "The basics: who you are, where you work and how to reach you.",
    fields: [
      { kind: "text", key: "businessName", label: "Business name", hint: "The name your customers know you by.", required: true, short: "your business name" },
      { kind: "text", key: "legalName", label: "Registered business name, if different" },
      { kind: "text", key: "abn", label: "ABN or company number" },
      { kind: "choice", key: "businessType", label: "Which best describes your business?", required: true, short: "your type of business", options: [{ value: "Real estate", label: "Real estate" }, { value: "Health and fitness", label: "Health and fitness" }, { value: "Other", label: "Something else" }] },
      { kind: "textarea", key: "whatYouSell", label: "What you sell, in a sentence or two", maxLength: 600 },
      { kind: "text", key: "customers", label: "Who your customers are", placeholder: "e.g. homeowners, landlords, other businesses" },
      { kind: "text", key: "serviceAreas", label: "Areas you serve", placeholder: "Suburbs, cities or regions, separated by commas" },
      { kind: "textarea", key: "addresses", label: "Business addresses, as they should appear on emails", hint: "One per line.", maxLength: 600 },
      { kind: "select", key: "timezone", label: "Your main time zone", required: true, short: "your time zone", placeholder: "Choose a time zone", options: REGION_PRESETS.map((p) => ({ value: p.timezone, label: p.label })) },
      { kind: "select", key: "currency", label: "The currency you charge in", placeholder: "Same as your time zone's", options: opts("AUD", "NZD", "GBP", "USD", "SGD") },
      { kind: "tel", key: "phone", label: "Main business phone number" },
      { kind: "url", key: "website", label: "Website", placeholder: "yourbusiness.com" },
      { kind: "url", key: "facebook", label: "Facebook page", placeholder: "facebook.com/…" },
      { kind: "url", key: "instagram", label: "Instagram", placeholder: "instagram.com/…" },
      { kind: "url", key: "linkedin", label: "LinkedIn", placeholder: "linkedin.com/company/…" },
      { kind: "url", key: "youtube", label: "YouTube", placeholder: "youtube.com/@…" },
      { kind: "text", key: "staff", label: "How many people work in the business?", placeholder: "e.g. 4 full-time, 2 part-time" },
      { kind: "text", key: "years", label: "Years in operation" },
      { kind: "text", key: "contactName", label: "Your name", required: true, short: "your name" },
      { kind: "text", key: "contactRole", label: "Your role" },
      { kind: "email", key: "contactEmail", label: "Your email", required: true, short: "your email address" },
      { kind: "tel", key: "contactMobile", label: "Your mobile" },
      { kind: "text", key: "decisionMaker", label: "Decision-maker, if not you", placeholder: "Name, role and email" },
      { kind: "text", key: "billingContact", label: "Accounts or billing contact", placeholder: "Name and email" },
    ],
  },
  {
    id: "goals",
    title: "What you want from Me²",
    intro: "So we start on what matters most to you.",
    fields: [
      { kind: "textarea", key: "prompted", label: "What made you look for help now?" },
      { kind: "textarea", key: "sixMonths", label: "If this works, what's different in six months?" },
      { kind: "textarea", key: "topGoals", label: "Your top three goals, most important first" },
      { kind: "text", key: "measure", label: "How will you measure success?", placeholder: "e.g. hours saved, reply times, more leads, fewer errors" },
      { kind: "number", key: "adminHours", label: "Roughly how many hours a week go on admin now?" },
      { kind: "textarea", key: "timeBack", label: "What would you do with that time back?" },
      { kind: "text", key: "deadline", label: "Any deadline or busy period we should be ready for?" },
      { kind: "select", key: "budget", label: "Monthly budget you have in mind", placeholder: "Choose a range", options: opts("Under $1,000", "$1,000 to $2,500", "$2,500 to $5,000", "Over $5,000", "Not sure yet") },
      { kind: "textarea", key: "pastHelp", label: "Have you used a VA or agency before? What worked and what didn't?" },
      { kind: "textarea", key: "dealBreakers", label: "Anything that would make you end the arrangement?", hint: "Tell us your deal-breakers up front." },
    ],
  },
  {
    id: "today",
    title: "How your back office runs today",
    intro: "Rough numbers are fine. Skip any task that doesn't apply.",
    fields: [
      {
        kind: "tasks",
        key: "tasks",
        label: "For each task: about how many hours a week, and would you hand it to us?",
        options: ["Email inbox management", "Phone, SMS and chat enquiries", "Calendar and appointment booking", "Quotes and proposals", "Invoicing and payment follow-up", "Bookkeeping and reconciliation", "Data entry and CRM updates", "Customer onboarding and paperwork", "Supplier and contractor coordination", "Reports and spreadsheets", "Social media and marketing content", "Website updates and Google Business Profile", "Reviews: asking for them and replying", "Recruitment admin and rostering"],
      },
      { kind: "text", key: "otherTasks", label: "Anything else you'd hand over?" },
      { kind: "textarea", key: "frustrations", label: "Which tasks frustrate you most, and why?" },
      { kind: "textarea", key: "cracks", label: "Where do things fall through the cracks?", placeholder: "e.g. missed follow-ups, slow replies, errors" },
      { kind: "textarea", key: "keep", label: "Which tasks must stay with you or your team?" },
      { kind: "text", key: "documented", label: "Are your processes written down anywhere? Where?" },
      { kind: "text", key: "peaks", label: "When does the workload spike?", placeholder: "Days, hours or seasons" },
    ],
  },
  {
    id: "enquiries",
    title: "Your enquiries and customers",
    intro: "This sets how fast we answer your enquiries, which ones come to you, and how we follow up.",
    fields: [
      { kind: "channels", key: "channels", label: "Where do enquiries come from? Tick each one, with roughly how many a month.", options: ["Website forms", "Facebook and Instagram lead forms", "Google Ads landing pages", "Listing sites or marketplaces (e.g. realestate.com.au, Domain)", "Phone calls, including missed calls", "Text messages and WhatsApp", "Social media messages and comments", "Email", "Referrals and walk-ins"] },
      { kind: "textarea", key: "greenCriteria", label: "What makes an enquiry worth your personal time?", hint: "One per line, e.g. owns a property in our area; wants a quote; ready to start this month." },
      { kind: "text", key: "highIntent", label: "Which services or requests are worth the most to you?" },
      { kind: "textarea", key: "autoHandled", label: "Which enquiries could we answer without involving you?", hint: "One per line, e.g. opening hours, availability, applications." },
      { kind: "choice", key: "requirePhone", label: "Must someone give a phone number before you treat them as a serious lead?", options: YES_NO },
      { kind: "select", key: "firstResponse", label: "How quickly should a new enquiry get its first reply?", placeholder: "Choose a time", options: opts("5 minutes", "15 minutes", "30 minutes", "1 hour", "4 hours") },
      { kind: "select", key: "bookingWindow", label: "How soon should a good lead be booked in for a call, visit or appointment?", placeholder: "Choose a time", options: opts("Same day", "24 hours", "48 hours", "3 days", "1 week") },
      { kind: "select", key: "quietFrom", label: "No automated texts or emails after", placeholder: "Choose a time", options: [18, 19, 20, 21, 22, 23].map((h) => ({ value: `${h}:00`, label: `${h - 12}:00 pm` })) },
      { kind: "select", key: "quietTo", label: "…or before", placeholder: "Choose a time", options: [5, 6, 7, 8, 9, 10].map((h) => ({ value: `${String(h).padStart(2, "0")}:00`, label: `${h}:00 am` })) },
      { kind: "text", key: "booking", label: "How do customers book with you today?", placeholder: "e.g. Google Calendar, Outlook, a booking app, by phone" },
      { kind: "text", key: "stages", label: "The steps from first enquiry to paying customer", placeholder: "e.g. enquiry, appraisal, agreement sent, signed" },
      { kind: "select", key: "quoteQuiet", label: "After you send a quote, how long before we follow up if you hear nothing?", placeholder: "Choose a time", options: opts("2 days", "3 days", "5 days", "7 days", "14 days") },
      { kind: "number", key: "customerValue", label: "What is a typical new customer worth to you?", hint: "Their first sale or first year, in your currency. A rough figure is fine." },
      { kind: "url", key: "reviewUrl", label: "Your Google review link", hint: "Where customers should leave a review. Leave blank if you don't have one yet." },
      { kind: "choice", key: "pastCustomers", label: "Do you have past customers we could get back in touch with?", options: opts("Yes", "No", "Not sure") },
      { kind: "choice", key: "inventory", label: "Do you keep track of something customers ask about, such as listings, a rent roll, class spaces or stock?", options: YES_NO },
      { kind: "text", key: "inventoryWhere", label: "Where is it kept?", placeholder: "e.g. PropertyMe, a spreadsheet", showIf: { key: "inventory", in: ["Yes"] } },
    ],
  },
  {
    id: "team",
    title: "Your team",
    intro: "Everyone who should use your Me² portal or hear from us, starting with yourself. We create each person's sign-in from this list.",
    fields: [
      { kind: "team", key: "team", label: "People" },
      { kind: "teamSelect", key: "escalateTo", label: "Who should we tell when a good lead hasn't booked in time, or a quote has gone quiet?" },
      { kind: "choice", key: "signedBy", label: "Who should our messages to your customers be signed by?", options: [{ value: "The business", label: "The business" }, { value: "The team member", label: "The team member looking after them" }] },
    ],
  },
  {
    id: "services",
    title: "Services and systems",
    intro: "What you'd like help with, and the tools you use today.",
    fields: [
      { kind: "checks", key: "services", label: "Which services would you like to talk about?", hint: "Not sure? Leave them all blank and we'll recommend a fit.", options: ["Individual AI Role: one dedicated role, such as admin, inbox or accounts, run by AI with a trained operator", "Managed Unit: a small team covering several functions, managed end to end", "Website design or rebuild", "SEO", "Google Workspace setup or migration", "Google Business Profile management", "Social media content and management", "Paid advertising (Meta, Google)"] },
      { kind: "text", key: "startHere", label: "Which one area would make the biggest difference first?" },
      { kind: "date", key: "startDate", label: "Preferred start date" },
      { kind: "text", key: "cover", label: "Hours of cover you need", placeholder: "e.g. business hours, after-hours, weekends" },
      {
        kind: "tools",
        key: "tools",
        label: "The tools you use, and whether we can have access",
        hint: "Please don't type passwords here. We set up secure access with you separately.",
        options: [
          { area: "Email and calendar", placeholder: "e.g. Google Workspace, Outlook" },
          { area: "File storage", placeholder: "e.g. Drive, OneDrive, Dropbox" },
          { area: "Accounting and invoicing", placeholder: "e.g. Xero, QuickBooks" },
          { area: "Payments and payroll", placeholder: "e.g. Square, Stripe" },
          { area: "CRM or customer database", placeholder: "e.g. HubSpot" },
          { area: "Industry software", placeholder: "e.g. PropertyMe, practice or job management" },
          { area: "Booking or scheduling", placeholder: "e.g. Calendly, Cal.com, Mindbody" },
          { area: "Phone, SMS and messaging", placeholder: "e.g. mobile, WhatsApp" },
          { area: "Project or task management", placeholder: "e.g. Asana, Trello" },
          { area: "Website and domain", placeholder: "e.g. WordPress, Squarespace, GoDaddy" },
          { area: "Social media pages and ad accounts", placeholder: "e.g. Facebook, Instagram, Google Ads" },
        ],
      },
      { kind: "text", key: "itManager", label: "Who manages your IT, domain and email today?" },
      { kind: "text", key: "twoFactor", label: "Do you use two-factor sign-in? On which accounts?" },
      { kind: "text", key: "toolChanges", label: "Any tools you're planning to change or drop?" },
      { kind: "text", key: "aiTools", label: "Are you already using AI tools, such as ChatGPT or Copilot? For what?" },
      { kind: "choice", key: "smsChoice", label: "Should texts to your customers come from a dedicated business number?", options: [{ value: "existing", label: "Use our existing number" }, { value: "new", label: "Set up a new number for us" }, { value: "none", label: "No texting, please" }] },
      { kind: "tel", key: "smsExisting", label: "Which number?", showIf: { key: "smsChoice", in: ["existing"] } },
    ],
  },
  {
    id: "brand",
    title: "Brand, voice and content",
    intro: "Anything we write or design for you should look and sound like you.",
    fields: [
      { kind: "text", key: "personality", label: "Your brand's personality in three words" },
      { kind: "text", key: "voice", label: "How should we sound when we write as you?", placeholder: "e.g. friendly and plain-spoken, never pushy" },
      { kind: "textarea", key: "example", label: "Paste an email or post that sounds exactly like you", maxLength: 2000 },
      { kind: "text", key: "senderName", label: "The name customers should see on our messages" },
      { kind: "email", key: "replyTo", label: "The email address replies should go to" },
      { kind: "text", key: "banned", label: "Words or phrases we must never use", hint: "Separate them with commas." },
      { kind: "text", key: "claims", label: "Claims we may only make with proof on file", placeholder: "e.g. prices, results, yields" },
      { kind: "text", key: "footer", label: "A line that must appear on every ad, post and email", placeholder: "e.g. Business Name | Licence 000000", hint: "Required for licensed businesses such as real estate." },
      { kind: "text", key: "otherRules", label: "Any other advertising rules for your industry?", placeholder: "e.g. mandatory disclaimers, things you can't show" },
      { kind: "text", key: "brandOwner", label: "Who designed your brand, and do you own the files and rights?" },
      { kind: "text", key: "admire", label: "Competitors or brands you admire, and why" },
      { kind: "checks", key: "brandKit", label: "Which of these can you send us?", hint: "We'll share an upload folder after you submit.", options: ["Logo files (SVG, AI, EPS or PDF, plus a PNG)", "Logo variations (colour, single colour, white, icon)", "Brand guidelines or style guide", "Brand colours", "Fonts and licence files", "Email signature and letterhead", "Document templates (quotes, invoices, proposals)", "Photos of your team, premises and work", "Existing marketing material", "A spreadsheet of past customers", "Your listings, rent roll, timetable or price list"] },
      { kind: "checks", key: "socialChannels", label: "Which channels should we post on?", hint: "Skip this if you don't want marketing support.", options: SOCIAL_CHANNELS },
      { kind: "select", key: "postsPerWeek", label: "How many posts a week?", placeholder: "Choose a number", options: opts("1", "2", "3", "4", "5", "6", "7") },
      { kind: "checks", key: "postingDays", label: "Best days to post", options: DAYS },
      { kind: "select", key: "postingTime", label: "Best time of day to post", placeholder: "Choose a time", options: [{ value: "7am", label: "7:00 am" }, { value: "9am", label: "9:00 am" }, { value: "12pm", label: "12:00 pm" }, { value: "5pm", label: "5:00 pm" }, { value: "7pm", label: "7:00 pm" }] },
      { kind: "text", key: "approvals", label: "Who signs off posts that mention prices, people or results?" },
      { kind: "text", key: "material", label: "What can we turn into posts?", placeholder: "e.g. voice notes, photos, reviews, new listings or products" },
      { kind: "number", key: "adMeta", label: "Monthly ad budget for Meta (Facebook and Instagram)" },
      { kind: "number", key: "adGoogle", label: "Monthly ad budget for Google" },
      { kind: "text", key: "adOwner", label: "Who owns your ad accounts and pays for them?" },
    ],
  },
  {
    id: "working",
    title: "Working together",
    intro: "How you'd like us to keep in touch and what we may do on your behalf.",
    fields: [
      { kind: "choice", key: "contactChannel", label: "Best way to reach you day to day", options: opts("Email", "WhatsApp", "Phone", "Slack") },
      { kind: "choice", key: "updates", label: "How often would you like updates?", options: opts("Daily", "Weekly", "Monthly") },
      { kind: "text", key: "approver", label: "Who can approve work and spending on your behalf?" },
      { kind: "textarea", key: "withoutAsking", label: "What can we do without asking first, and what always needs your sign-off?" },
      { kind: "choice", key: "replyDirectly", label: "Can we reply to your customers directly?", options: [{ value: "Yes, under your name", label: "Yes, under our business name" }, { value: "Yes, under Me²'s name", label: "Yes, as Me²" }, { value: "No, check with us first", label: "No, check with us first" }] },
      { kind: "select", key: "responseTime", label: "How quickly do you expect us to reply to you?", placeholder: "Choose a time", options: opts("Within an hour", "Same business day", "Next business day") },
      { kind: "text", key: "bestTimes", label: "Best times to reach you, and times to avoid" },
      { kind: "text", key: "urgent", label: "How should we raise something urgent?" },
    ],
  },
  {
    id: "care",
    title: "Compliance and privacy",
    intro: "Anything we must handle with care.",
    fields: [
      { kind: "text", key: "licences", label: "Licences or regulators that apply to you", placeholder: "e.g. real estate, finance, health, trade licences" },
      { kind: "textarea", key: "sensitive", label: "Will we handle personal or sensitive information?", placeholder: "e.g. ID documents, health or financial details, children's data" },
      { kind: "textarea", key: "dataRules", label: "Any rules on where your data can be stored or handled, including outside your country?" },
      { kind: "choice", key: "nda", label: "Do you need us to sign an NDA or your own confidentiality terms?", options: opts("Yes", "No", "Not sure") },
      { kind: "textarea", key: "extraCare", label: "Customers, suppliers or topics we must handle with extra care" },
      { kind: "text", key: "accessibility", label: "Accessibility, language or cultural needs for your customers or team" },
      { kind: "text", key: "consent", label: "How do customers agree to hear from you by text or email today?", placeholder: "e.g. a tick box on a form, at sign-up" },
      { kind: "textarea", key: "anythingElse", label: "Anything we haven't asked that we should know?" },
    ],
  },
  {
    id: "send",
    title: "Check and send",
    intro: "Send it when you're ready. Anything you've skipped, we'll pick up on your intake call.",
    fields: [
      { kind: "confirm", key: "confirm", label: "I confirm this information is accurate to the best of my knowledge", required: true, short: "the confirmation tick" },
      { kind: "text", key: "signedName", label: "Your full name", required: true, short: "your full name" },
    ],
  },
];

export const FIELDS: Field[] = STEPS.flatMap((s) => s.fields);
const FIELD_BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));

export function fieldVisible(field: Field, answers: OnboardingAnswers): boolean {
  if (!field.showIf) return true;
  const value = answers[field.showIf.key];
  return typeof value === "string" && field.showIf.in.includes(value);
}

export function emptyTeamRow(partial: Partial<TeamRow> = {}): TeamRow {
  return { name: "", title: "", email: "", mobile: "", alerts: true, approves: false, finances: false, users: false, allRecords: false, ...partial };
}

// ---------------------------------------------------------------------------
// Validation: what the server keeps from whatever the browser sends
// ---------------------------------------------------------------------------

const CHOICES: Choice[] = ["", "Yes", "Maybe", "No"];
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const choice = (v: unknown): Choice => (CHOICES.includes(v as Choice) ? (v as Choice) : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function maxLengthOf(field: Field): number {
  if ("maxLength" in field && field.maxLength) return field.maxLength;
  return field.kind === "textarea" ? 3000 : 300;
}

/**
 * Keeps only the fields the form defines, in the shape it defines, with every
 * string bounded. Unknown keys, wrong types and values outside a field's
 * options are dropped rather than rejected, so a stale tab can always save.
 */
export function sanitizeAnswers(raw: unknown): OnboardingAnswers {
  const input = obj(raw);
  const out: OnboardingAnswers = {};
  for (const field of FIELDS) {
    const value = input[field.key];
    if (value === undefined || value === null) continue;
    switch (field.kind) {
      case "select":
      case "choice": {
        const s = str(value, 200);
        if (s === "" || field.options.some((o) => o.value === s)) out[field.key] = s;
        break;
      }
      case "checks":
        if (Array.isArray(value)) out[field.key] = [...new Set(value.filter((v): v is string => typeof v === "string" && field.options.includes(v)))];
        break;
      case "confirm":
        out[field.key] = value === "yes" ? "yes" : "";
        break;
      case "team":
        if (Array.isArray(value))
          out[field.key] = value.slice(0, 30).map((r) => {
            const row = obj(r);
            return { name: str(row.name, 120), title: str(row.title, 120), email: str(row.email, 200), mobile: str(row.mobile, 40), alerts: row.alerts === true, approves: row.approves === true, finances: row.finances === true, users: row.users === true, allRecords: row.allRecords === true };
          });
        break;
      case "channels": {
        const rows = obj(value);
        const kept: Record<string, string> = {};
        for (const option of field.options) if (typeof rows[option] === "string") kept[option] = str(rows[option], 20);
        out[field.key] = kept;
        break;
      }
      case "tasks": {
        const rows = obj(value);
        const kept: Record<string, TaskRow> = {};
        for (const option of field.options) if (rows[option] !== undefined) kept[option] = { hours: str(obj(rows[option]).hours, 20), hand: choice(obj(rows[option]).hand) };
        out[field.key] = kept;
        break;
      }
      case "tools": {
        const rows = obj(value);
        const kept: Record<string, ToolRow> = {};
        for (const { area } of field.options) if (rows[area] !== undefined) kept[area] = { tool: str(obj(rows[area]).tool, 200), access: choice(obj(rows[area]).access) };
        out[field.key] = kept;
        break;
      }
      default:
        out[field.key] = str(value, maxLengthOf(field));
    }
  }
  return out;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "a", "a and b", "a, b and c". */
export function joinWithAnd(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
/** The fields still needed before the form can be sent, with their step for the summary. */
export function missingRequired(answers: OnboardingAnswers): { stepId: string; stepTitle: string; label: string; short: string }[] {
  const missing: { stepId: string; stepTitle: string; label: string; short: string }[] = [];
  for (const step of STEPS) {
    for (const field of step.fields) {
      if (!field.required || !fieldVisible(field, answers)) continue;
      const value = answers[field.key];
      const filled = field.kind === "confirm" ? value === "yes" : typeof value === "string" && value.trim() !== "" && (field.kind !== "email" || EMAIL.test(value.trim()));
      if (!filled) missing.push({ stepId: step.id, stepTitle: step.title, label: field.label, short: field.short ?? field.label.toLowerCase() });
    }
  }
  return missing;
}

/** How far through the form the client is: answered fields over visible fields, per step. */
export function stepProgress(answers: OnboardingAnswers): Record<string, { answered: number; total: number }> {
  const out: Record<string, { answered: number; total: number }> = {};
  for (const step of STEPS) {
    const visible = step.fields.filter((f) => fieldVisible(f, answers));
    out[step.id] = { answered: visible.filter((f) => isAnswered(f, answers[f.key])).length, total: visible.length };
  }
  return out;
}

export function isAnswered(field: Field, value: AnswerValue | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === "string") return field.kind === "confirm" ? value === "yes" : value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0 && (field.kind !== "team" || (value as TeamRow[]).some((r) => r.name.trim() || r.email.trim()));
  return Object.values(value).some((v) => (typeof v === "string" ? v.trim() !== "" : Object.values(v).some((x) => typeof x === "string" && x.trim() !== "")));
}

const HAND_LABEL: Record<Choice, string> = { "": "", Yes: "hand over", Maybe: "maybe hand over", No: "keep in-house" };

/** A plain-text rendering of one answer, for the console's read-only view. */
export function describeAnswer(field: Field, value: AnswerValue | undefined): string {
  if (value === undefined || !isAnswered(field, value)) return "";
  if (typeof value === "string") {
    if (field.kind === "confirm") return "Confirmed";
    if (field.kind === "select" || field.kind === "choice") return field.options.find((o) => o.value === value)?.label ?? value;
    return value;
  }
  if (Array.isArray(value)) {
    if (field.kind === "team") return (value as TeamRow[]).filter((r) => r.name || r.email).map((r) => `${r.name || r.email}${r.title ? `, ${r.title}` : ""}${r.email ? ` (${r.email})` : ""}: ${TEAM_PERMISSIONS.filter((p) => r[p.key]).map((p) => p.label.toLowerCase()).join(", ") || "no permissions"}`).join("\n");
    return (value as string[]).join(", ");
  }
  return Object.entries(value)
    .map(([k, v]) => {
      if (typeof v === "string") return v.trim() ? `${k}: ${v}` : k;
      if ("hand" in v) return v.hours || v.hand ? `${k}: ${[v.hours ? `${v.hours} h/week` : null, v.hand ? HAND_LABEL[v.hand as Choice] : null].filter(Boolean).join(", ")}` : "";
      return v.tool || v.access ? `${k}: ${[v.tool || null, v.access ? `access: ${v.access}` : null].filter(Boolean).join(", ")}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

export function fieldByKey(key: string): Field | undefined {
  return FIELD_BY_KEY.get(key);
}
