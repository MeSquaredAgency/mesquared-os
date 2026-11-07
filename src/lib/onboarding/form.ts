import { REGION_PRESETS } from "@/lib/tenants/regions";
import type { Permission } from "@/lib/types";

/**
 * The client onboarding questionnaire, defined once.
 *
 * - CLIENT_STEPS is what the client fills in before their intake call: four
 *   short steps, about ten minutes, mostly taps.
 * - CALL_SECTIONS is the operator's intake call sheet: the same fields plus
 *   everything that is better asked in conversation.
 *
 * Both share field definitions by key, so an answer typed by the client shows
 * up on the call sheet and the other way round. The server validates against
 * the same lists. No server imports: the client components use it too.
 *
 * Client-facing wording never says "tenant", "green" or "red".
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

/** Client answers the client asked to leave for the intake call, by field key. */
export const ASK_ON_CALL = "askOnCall";

interface Base {
  key: string;
  label: string;
  hint?: string;
  required?: boolean;
  /** How a required field is named mid-sentence ("Still needed: your email and …"). */
  short?: string;
  /** The operator's wording on the call sheet and review page, when the client's wording says "you". */
  callLabel?: string;
  /** Offer "Not sure, ask me on the call" under it in the client form. */
  onCall?: boolean;
  /** Shown only when another answer is one of these values. */
  showIf?: { key: string; in: string[] };
}

export type Field =
  | (Base & { kind: "text" | "email" | "tel" | "url" | "number" | "date"; placeholder?: string; maxLength?: number })
  | (Base & { kind: "textarea"; placeholder?: string; maxLength?: number })
  | (Base & { kind: "select" | "choice"; options: { value: string; label: string }[]; placeholder?: string })
  | (Base & { kind: "cards"; options: { value: string; label: string; hint?: string }[] })
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
  /** Rough minutes the step takes, for "about N minutes left". */
  minutes?: number;
  /** A short name for the step bar. */
  nav?: string;
  fields: Field[];
}

const opts = (...values: string[]) => values.map((v) => ({ value: v, label: v }));
const YES_NO = opts("Yes", "No");

/**
 * A standard list of business types. The platform has three industry
 * templates; each type is set up on the closest one, and `licensed` types are
 * asked for the line every ad must carry.
 */
export const INDUSTRIES: { label: string; examples: string; templateKey: string; licensed?: boolean }[] = [
  { label: "Real estate and property", examples: "Sales, property management, strata", templateKey: "real_estate", licensed: true },
  { label: "Health and fitness", examples: "Gyms, studios, personal training", templateKey: "health_fitness" },
  { label: "Allied health and wellness", examples: "Physio, chiro, massage, psychology", templateKey: "clinic", licensed: true },
  { label: "Medical and dental", examples: "Clinics, dentists, specialists", templateKey: "clinic", licensed: true },
  { label: "Beauty, hair and spa", examples: "Salons, barbers, skin and nails", templateKey: "beauty" },
  { label: "Trades and home services", examples: "Plumbing, electrical, cleaning, landscaping", templateKey: "trades", licensed: true },
  { label: "Building and construction", examples: "Builders, renovators, architects", templateKey: "construction", licensed: true },
  { label: "Professional services", examples: "Accounting, legal, consulting", templateKey: "professional", licensed: true },
  { label: "Finance and insurance", examples: "Mortgage brokers, advisers, insurers", templateKey: "finance", licensed: true },
  { label: "Retail and e-commerce", examples: "Shops, online stores", templateKey: "retail" },
  { label: "Hospitality", examples: "Cafés, restaurants, bars, catering", templateKey: "hospitality" },
  { label: "Travel, tourism and events", examples: "Tours, venues, event services", templateKey: "hospitality" },
  { label: "Education and childcare", examples: "Tutoring, training, early learning", templateKey: "education" },
  { label: "Automotive", examples: "Dealers, mechanics, detailing", templateKey: "automotive", licensed: true },
  { label: "Creative, marketing and media", examples: "Agencies, photography, design", templateKey: "generic" },
  { label: "Technology and software", examples: "SaaS, IT services, apps", templateKey: "generic" },
  { label: "Manufacturing and wholesale", examples: "Makers, suppliers, distributors", templateKey: "generic" },
  { label: "Transport and logistics", examples: "Couriers, removals, freight", templateKey: "generic" },
  { label: "Agriculture", examples: "Farms, nurseries, produce", templateKey: "generic" },
  { label: "Not-for-profit and community", examples: "Charities, clubs, associations", templateKey: "generic" },
  { label: "Other", examples: "Something else", templateKey: "generic", licensed: true },
];
const LICENSED = INDUSTRIES.filter((i) => i.licensed).map((i) => i.label);

export const TEAM_PERMISSIONS: { key: keyof Pick<TeamRow, "alerts" | "approves" | "finances" | "users" | "allRecords">; label: string; hint: string; permission: Permission }[] = [
  { key: "alerts", label: "New-lead alerts", hint: "Hears about each new enquiry worth their time", permission: "RECEIVE_LEAD_ALERTS" },
  { key: "approves", label: "Approves posts and ads", hint: "Signs off content before it goes out", permission: "APPROVE_CONTENT" },
  { key: "finances", label: "Sees money and invoices", hint: "Revenue, spend and what is owed", permission: "VIEW_FINANCES" },
  { key: "users", label: "Adds or removes people", hint: "Manages who can sign in", permission: "MANAGE_USERS" },
  { key: "allRecords", label: "Sees every customer", hint: "Otherwise only the customers assigned to them", permission: "VIEW_ALL_RECORDS" },
];

export const SOCIAL_CHANNELS = ["Facebook", "Instagram", "TikTok", "YouTube (including Shorts)", "LinkedIn", "Google Business Profile"];
export const TASKS = ["Email inbox management", "Phone, SMS and chat enquiries", "Calendar and appointment booking", "Quotes and proposals", "Invoicing and payment follow-up", "Bookkeeping and reconciliation", "Data entry and CRM updates", "Customer onboarding and paperwork", "Supplier and contractor coordination", "Reports and spreadsheets", "Social media and marketing content", "Website updates and Google Business Profile", "Reviews: asking for them and replying", "Recruitment admin and rostering"];
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// ---------------------------------------------------------------------------
// Every field, once
// ---------------------------------------------------------------------------

const F = {
  businessName: { kind: "text", key: "businessName", label: "Business name", hint: "The name your customers know you by.", required: true, short: "your business name" },
  businessType: { callLabel: "Business type", kind: "cards", key: "businessType", label: "What kind of business is it?", required: true, short: "your type of business", options: INDUSTRIES.map((i) => ({ value: i.label, label: i.label, hint: i.examples })) },
  businessTypeOther: { callLabel: "Business type, if other", kind: "text", key: "businessTypeOther", label: "Tell us in a few words", placeholder: "e.g. dog grooming", required: true, short: "what kind of business it is", showIf: { key: "businessType", in: ["Other"] } },
  whatYouSell: { callLabel: "What they sell", kind: "text", key: "whatYouSell", label: "What you sell, in a line", placeholder: "e.g. property management for investors in Adelaide" },
  serviceAreas: { callLabel: "Areas they serve", kind: "text", key: "serviceAreas", label: "Areas you serve", placeholder: "Suburbs, cities or regions, separated by commas", onCall: true },
  timezone: { callLabel: "Time zone", kind: "select", key: "timezone", label: "Your time zone", required: true, short: "your time zone", placeholder: "Choose a time zone", options: REGION_PRESETS.map((p) => ({ value: p.timezone, label: p.label })) },
  currency: { kind: "select", key: "currency", label: "Currency they charge in", placeholder: "Same as the time zone's", options: opts("AUD", "NZD", "GBP", "USD", "SGD") },
  phone: { callLabel: "Business phone", kind: "tel", key: "phone", label: "Business phone number" },
  website: { kind: "url", key: "website", label: "Website", placeholder: "yourbusiness.com" },
  socialLinks: { kind: "text", key: "socialLinks", label: "Social media links", placeholder: "Paste your Facebook, Instagram or LinkedIn links" },
  addresses: { kind: "textarea", key: "addresses", label: "Business addresses, as they should appear on emails", hint: "One per line.", maxLength: 600 },
  legalName: { kind: "text", key: "legalName", label: "Registered business name, if different" },
  abn: { kind: "text", key: "abn", label: "ABN or company number" },
  customers: { kind: "text", key: "customers", label: "Who their customers are", placeholder: "e.g. homeowners, landlords, other businesses" },
  staff: { kind: "text", key: "staff", label: "How many people work in the business?", placeholder: "e.g. 4 full-time, 2 part-time" },
  years: { kind: "text", key: "years", label: "Years in operation" },
  contactName: { callLabel: "Contact's name", kind: "text", key: "contactName", label: "Your name", required: true, short: "your name" },
  contactRole: { kind: "text", key: "contactRole", label: "Their role" },
  contactEmail: { callLabel: "Contact's email", kind: "email", key: "contactEmail", label: "Your email", required: true, short: "your email address" },
  contactMobile: { callLabel: "Contact's mobile", kind: "tel", key: "contactMobile", label: "Your mobile" },
  decisionMaker: { kind: "text", key: "decisionMaker", label: "Decision-maker, if not the contact", placeholder: "Name, role and email" },
  billingContact: { kind: "text", key: "billingContact", label: "Accounts or billing contact", placeholder: "Name and email" },

  team: { kind: "team", key: "team", label: "People" },
  escalateTo: { callLabel: "Who hears when a good lead goes cold", kind: "teamSelect", key: "escalateTo", label: "When a good lead goes cold, who should we tell?", hint: "For example, an enquiry that hasn't booked in time, or a quote with no reply." },
  signedBy: { callLabel: "Who messages to customers are signed by", kind: "choice", key: "signedBy", label: "Who should messages to customers be signed by?", options: [{ value: "The business", label: "The business" }, { value: "The team member", label: "The team member looking after them" }] },

  senderName: { callLabel: "Name on their messages", kind: "text", key: "senderName", label: "The name on your messages", placeholder: "Usually your business name" },
  replyTo: { callLabel: "Where replies go", kind: "email", key: "replyTo", label: "Where should replies go?", placeholder: "office@yourbusiness.com" },
  firstResponse: { callLabel: "How quickly a new enquiry should hear back", kind: "choice", key: "firstResponse", label: "How quickly should a new enquiry hear back?", onCall: true, options: opts("5 minutes", "15 minutes", "30 minutes", "1 hour", "4 hours") },
  quietFrom: { kind: "select", key: "quietFrom", label: "No automated messages after", placeholder: "Choose a time", options: [18, 19, 20, 21, 22, 23].map((h) => ({ value: `${h}:00`, label: `${h - 12}:00 pm` })) },
  quietTo: { kind: "select", key: "quietTo", label: "…or before", placeholder: "Choose a time", options: [5, 6, 7, 8, 9, 10].map((h) => ({ value: `${String(h).padStart(2, "0")}:00`, label: `${h}:00 am` })) },
  smsChoice: { callLabel: "Texts from a business number?", kind: "choice", key: "smsChoice", label: "Should texts to customers come from a business number?", onCall: true, options: [{ value: "existing", label: "Use our existing number" }, { value: "new", label: "Set one up for us" }, { value: "none", label: "No texting, please" }] },
  smsExisting: { kind: "tel", key: "smsExisting", label: "Which number?", showIf: { key: "smsChoice", in: ["existing"] } },
  footer: { callLabel: "Line every ad, post and email must carry", kind: "text", key: "footer", label: "A line that must appear on every ad, post and email", placeholder: "e.g. Business Name | Licence 000000", hint: "Only if your industry requires one, such as a licence number.", onCall: true },
  banned: { callLabel: "Words or phrases never to use", kind: "text", key: "banned", label: "Words or phrases we should never use", hint: "Separate them with commas.", onCall: true },
  reviewUrl: { callLabel: "Google review link", kind: "url", key: "reviewUrl", label: "Your Google review link", hint: "Where happy customers should leave a review.", onCall: true },

  handOver: { callLabel: "Tasks they'd hand over", kind: "checks", key: "handOver", label: "Tick anything you'd happily never do again", options: TASKS },
  topGoal: { callLabel: "The one thing to fix first", kind: "text", key: "topGoal", label: "If we could fix one thing first, what would it be?", onCall: true },
  socialChannels: { callLabel: "Channels to post on", kind: "checks", key: "socialChannels", label: "Where should we post for you?", hint: "Skip this if you don't want help with marketing.", options: SOCIAL_CHANNELS },
  beforeCall: { callLabel: "What they wanted us to know before the call", kind: "textarea", key: "beforeCall", label: "Anything we should know before the call?", maxLength: 2000 },

  prompted: { kind: "textarea", key: "prompted", label: "What made them look for help now?" },
  sixMonths: { kind: "textarea", key: "sixMonths", label: "If this works, what's different in six months?" },
  topGoals: { kind: "textarea", key: "topGoals", label: "Their top three goals, most important first" },
  measure: { kind: "text", key: "measure", label: "How will they measure success?", placeholder: "e.g. hours saved, reply times, more leads" },
  adminHours: { kind: "number", key: "adminHours", label: "Hours a week on admin now" },
  timeBack: { kind: "textarea", key: "timeBack", label: "What would they do with that time back?" },
  deadline: { kind: "text", key: "deadline", label: "Any deadline or busy period to be ready for?" },
  budget: { kind: "select", key: "budget", label: "Monthly budget in mind", placeholder: "Choose a range", options: opts("Under $1,000", "$1,000 to $2,500", "$2,500 to $5,000", "Over $5,000", "Not sure yet") },
  pastHelp: { kind: "textarea", key: "pastHelp", label: "Used a VA or agency before? What worked and what didn't?" },
  dealBreakers: { kind: "textarea", key: "dealBreakers", label: "Deal-breakers: what would make them end the arrangement?" },

  tasks: { kind: "tasks", key: "tasks", label: "Hours a week per task, and whether to hand it over", options: TASKS },
  otherTasks: { kind: "text", key: "otherTasks", label: "Anything else they'd hand over?" },
  frustrations: { kind: "textarea", key: "frustrations", label: "Which tasks frustrate them most, and why?" },
  cracks: { kind: "textarea", key: "cracks", label: "Where do things fall through the cracks?", placeholder: "e.g. missed follow-ups, slow replies, errors" },
  keep: { kind: "textarea", key: "keep", label: "Which tasks must stay with them or their team?" },
  documented: { kind: "text", key: "documented", label: "Are processes written down anywhere? Where?" },
  peaks: { kind: "text", key: "peaks", label: "When does the workload spike?" },

  channels: { kind: "channels", key: "channels", label: "Where enquiries come from, with roughly how many a month", options: ["Website forms", "Facebook and Instagram lead forms", "Google Ads landing pages", "Listing sites or marketplaces (e.g. realestate.com.au, Domain)", "Phone calls, including missed calls", "Text messages and WhatsApp", "Social media messages and comments", "Email", "Referrals and walk-ins"] },
  greenCriteria: { kind: "textarea", key: "greenCriteria", label: "What makes an enquiry worth their personal time?", hint: "One per line." },
  highIntent: { kind: "text", key: "highIntent", label: "Which services or requests are worth the most?" },
  autoHandled: { kind: "textarea", key: "autoHandled", label: "Which enquiries can we answer without involving them?", hint: "One per line." },
  requirePhone: { kind: "choice", key: "requirePhone", label: "Must a lead give a phone number to count as serious?", options: YES_NO },
  bookingWindow: { kind: "select", key: "bookingWindow", label: "How soon should a good lead be booked in?", placeholder: "Choose a time", options: opts("Same day", "24 hours", "48 hours", "3 days", "1 week") },
  booking: { kind: "text", key: "booking", label: "How customers book today", placeholder: "e.g. Google Calendar, Outlook, a booking app, by phone" },
  stages: { kind: "text", key: "stages", label: "Steps from first enquiry to paying customer", placeholder: "e.g. enquiry, appraisal, agreement sent, signed" },
  quoteQuiet: { kind: "select", key: "quoteQuiet", label: "Days of silence before following up a quote", placeholder: "Choose", options: opts("2 days", "3 days", "5 days", "7 days", "14 days") },
  customerValue: { kind: "number", key: "customerValue", label: "What a typical new customer is worth", hint: "First sale or first year, in their currency." },
  pastCustomers: { kind: "choice", key: "pastCustomers", label: "Past customers we could get back in touch with?", options: opts("Yes", "No", "Not sure") },
  inventory: { kind: "choice", key: "inventory", label: "Do they track listings, a rent roll, class spaces or stock?", options: YES_NO },
  inventoryWhere: { kind: "text", key: "inventoryWhere", label: "Where is it kept?", placeholder: "e.g. PropertyMe, a spreadsheet", showIf: { key: "inventory", in: ["Yes"] } },

  services: { kind: "checks", key: "services", label: "Services to talk about", options: ["Individual AI Role: one dedicated role, such as admin, inbox or accounts, run by AI with a trained operator", "Managed Unit: a small team covering several functions, managed end to end", "Website design or rebuild", "SEO", "Google Workspace setup or migration", "Google Business Profile management", "Social media content and management", "Paid advertising (Meta, Google)"] },
  startHere: { kind: "text", key: "startHere", label: "The one area that would make the biggest difference first" },
  startDate: { kind: "date", key: "startDate", label: "Preferred start date" },
  cover: { kind: "text", key: "cover", label: "Hours of cover needed", placeholder: "e.g. business hours, after-hours, weekends" },
  tools: {
    kind: "tools",
    key: "tools",
    label: "Tools they use, and whether we can have access",
    hint: "Never write passwords here. Access is set up securely and separately.",
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
  itManager: { kind: "text", key: "itManager", label: "Who manages their IT, domain and email?" },
  twoFactor: { kind: "text", key: "twoFactor", label: "Two-factor sign-in: which accounts?" },
  toolChanges: { kind: "text", key: "toolChanges", label: "Tools they plan to change or drop" },
  aiTools: { kind: "text", key: "aiTools", label: "AI tools already in use, and for what" },

  personality: { kind: "text", key: "personality", label: "Brand personality in three words" },
  voice: { kind: "text", key: "voice", label: "How we should sound when writing as them", placeholder: "e.g. friendly and plain-spoken, never pushy" },
  example: { kind: "textarea", key: "example", label: "An email or post that sounds exactly like them", maxLength: 2000 },
  claims: { kind: "text", key: "claims", label: "Claims we may only make with proof on file", placeholder: "e.g. prices, results, yields" },
  otherRules: { kind: "text", key: "otherRules", label: "Other advertising rules for their industry" },
  brandOwner: { kind: "text", key: "brandOwner", label: "Who designed the brand, and do they own the files?" },
  admire: { kind: "text", key: "admire", label: "Competitors or brands they admire, and why" },
  brandKit: { kind: "checks", key: "brandKit", label: "What they can send us", options: ["Logo files (SVG, AI, EPS or PDF, plus a PNG)", "Logo variations (colour, single colour, white, icon)", "Brand guidelines or style guide", "Brand colours", "Fonts and licence files", "Email signature and letterhead", "Document templates (quotes, invoices, proposals)", "Photos of the team, premises and work", "Existing marketing material", "A spreadsheet of past customers", "Listings, rent roll, timetable or price list"] },
  postsPerWeek: { kind: "select", key: "postsPerWeek", label: "Posts a week", placeholder: "Choose", options: opts("1", "2", "3", "4", "5", "6", "7") },
  postingDays: { kind: "checks", key: "postingDays", label: "Best days to post", options: DAYS },
  postingTime: { kind: "select", key: "postingTime", label: "Best time of day to post", placeholder: "Choose", options: [{ value: "7am", label: "7:00 am" }, { value: "9am", label: "9:00 am" }, { value: "12pm", label: "12:00 pm" }, { value: "5pm", label: "5:00 pm" }, { value: "7pm", label: "7:00 pm" }] },
  approvals: { kind: "text", key: "approvals", label: "Who signs off posts with prices, people or results" },
  material: { kind: "text", key: "material", label: "What we can turn into posts", placeholder: "e.g. voice notes, photos, reviews, new listings" },
  adMeta: { kind: "number", key: "adMeta", label: "Monthly ad budget: Meta (Facebook and Instagram)" },
  adGoogle: { kind: "number", key: "adGoogle", label: "Monthly ad budget: Google" },
  adOwner: { kind: "text", key: "adOwner", label: "Who owns the ad accounts and pays for them" },

  contactChannel: { kind: "choice", key: "contactChannel", label: "Best way to reach them day to day", options: opts("Email", "WhatsApp", "Phone", "Slack") },
  updates: { kind: "choice", key: "updates", label: "How often they want updates", options: opts("Daily", "Weekly", "Monthly") },
  approver: { kind: "text", key: "approver", label: "Who can approve work and spending" },
  withoutAsking: { kind: "textarea", key: "withoutAsking", label: "What we can do without asking, and what always needs sign-off" },
  replyDirectly: { kind: "choice", key: "replyDirectly", label: "Can we reply to their customers directly?", options: [{ value: "Yes, under your name", label: "Yes, under their name" }, { value: "Yes, under Me²'s name", label: "Yes, as Me²" }, { value: "No, check with us first", label: "No, check first" }] },
  responseTime: { kind: "select", key: "responseTime", label: "How quickly they expect us to reply", placeholder: "Choose", options: opts("Within an hour", "Same business day", "Next business day") },
  bestTimes: { kind: "text", key: "bestTimes", label: "Best times to reach them, and times to avoid" },
  urgent: { kind: "text", key: "urgent", label: "How to raise something urgent" },

  licences: { kind: "text", key: "licences", label: "Licences or regulators that apply" },
  sensitive: { kind: "textarea", key: "sensitive", label: "Personal or sensitive information we'll handle", placeholder: "e.g. ID documents, health or financial details, children's data" },
  dataRules: { kind: "textarea", key: "dataRules", label: "Rules on where data can be stored or handled, including outside their country" },
  nda: { kind: "choice", key: "nda", label: "NDA or their own confidentiality terms needed?", options: opts("Yes", "No", "Not sure") },
  extraCare: { kind: "textarea", key: "extraCare", label: "Customers, suppliers or topics to handle with extra care" },
  accessibility: { kind: "text", key: "accessibility", label: "Accessibility, language or cultural needs" },
  consent: { kind: "text", key: "consent", label: "How customers agree to hear from them by text or email", placeholder: "e.g. a tick box on a form, at sign-up" },
  anythingElse: { kind: "textarea", key: "anythingElse", label: "Anything else we should know" },
} satisfies Record<string, Field>;

// ---------------------------------------------------------------------------
// The client's form: four short steps
// ---------------------------------------------------------------------------

export const CLIENT_STEPS: Step[] = [
  { id: "basics", nav: "The basics", title: "Let's start with the basics", intro: "Who you are and how customers find you.", minutes: 3, fields: [F.businessName, F.businessType, F.businessTypeOther, F.whatYouSell, F.serviceAreas, F.timezone, F.phone, F.website, F.socialLinks, F.contactName, F.contactEmail, F.contactMobile] },
  { id: "team", nav: "Your team", title: "Who's on your team?", intro: "Everyone who should use your Me² portal. You're already on the list; add anyone else and choose what they can do.", minutes: 2, fields: [F.team, F.escalateTo] },
  { id: "customers", nav: "Your customers", title: "How should we talk to your customers?", intro: "So every message sounds like you and arrives at a good time.", minutes: 3, fields: [F.senderName, F.replyTo, F.firstResponse, F.quietFrom, F.quietTo, F.smsChoice, F.smsExisting, { ...F.footer, showIf: { key: "businessType", in: LICENSED } }, F.banned, F.reviewUrl] },
  { id: "plate", nav: "Hand it over", title: "What can we take off your plate?", intro: "The fun part. Tick anything you'd like us to take on; we'll talk through the details on the call.", minutes: 2, fields: [F.handOver, F.topGoal, F.socialChannels, F.beforeCall] },
];

// ---------------------------------------------------------------------------
// The operator's intake call sheet: everything, grouped for the conversation
// ---------------------------------------------------------------------------

export const CALL_SECTIONS: Step[] = [
  { id: "business", title: "The business", intro: "Check what they gave us, then fill the gaps.", fields: [F.businessName, F.businessType, F.businessTypeOther, F.whatYouSell, F.customers, F.serviceAreas, F.addresses, F.timezone, F.currency, F.phone, F.website, F.socialLinks, F.legalName, F.abn, F.staff, F.years, F.contactName, F.contactRole, F.contactEmail, F.contactMobile, F.decisionMaker, F.billingContact] },
  { id: "goals", title: "Goals", intro: "What success looks like for them.", fields: [F.topGoal, F.prompted, F.sixMonths, F.topGoals, F.measure, F.adminHours, F.timeBack, F.deadline, F.budget, F.pastHelp, F.dealBreakers] },
  { id: "back-office", title: "Back office today", intro: "What they would hand over, and how much time it takes now.", fields: [F.handOver, F.tasks, F.otherTasks, F.frustrations, F.cracks, F.keep, F.documented, F.peaks] },
  { id: "enquiries", title: "Enquiries and customers", intro: "These set the qualifier, service levels and follow-ups.", fields: [F.channels, F.greenCriteria, F.highIntent, F.autoHandled, F.requirePhone, F.firstResponse, F.bookingWindow, F.quietFrom, F.quietTo, F.booking, F.stages, F.quoteQuiet, F.customerValue, F.reviewUrl, F.pastCustomers, F.inventory, F.inventoryWhere] },
  { id: "team", title: "Team", intro: "Sign-ins, permissions and who hears about missed leads.", fields: [F.team, F.escalateTo, F.signedBy] },
  { id: "systems", title: "Services and systems", intro: "What they want from us and the tools to connect.", fields: [F.services, F.startHere, F.startDate, F.cover, F.tools, F.itManager, F.twoFactor, F.toolChanges, F.aiTools, F.smsChoice, F.smsExisting] },
  { id: "brand", title: "Brand, voice and content", intro: "Everything we write must sound like them and stay compliant.", fields: [F.personality, F.voice, F.example, F.senderName, F.replyTo, F.banned, F.claims, F.footer, F.otherRules, F.brandOwner, F.admire, F.brandKit, F.socialChannels, F.postsPerWeek, F.postingDays, F.postingTime, F.approvals, F.material, F.adMeta, F.adGoogle, F.adOwner] },
  { id: "working", title: "Working together", intro: "How we keep in touch and what we may do on their behalf.", fields: [F.beforeCall, F.contactChannel, F.updates, F.approver, F.withoutAsking, F.replyDirectly, F.responseTime, F.bestTimes, F.urgent] },
  { id: "care", title: "Compliance and privacy", intro: "Anything to handle with care.", fields: [F.licences, F.sensitive, F.dataRules, F.nda, F.extraCare, F.accessibility, F.consent, F.anythingElse] },
];

/** Every field, once, whichever list it appears in. */
export const FIELDS: Field[] = Object.values(F) as Field[];
const FIELD_BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));
const CLIENT_KEYS = new Set(CLIENT_STEPS.flatMap((s) => s.fields.map((f) => f.key)));
const ASKABLE_KEYS = new Set(CLIENT_STEPS.flatMap((s) => s.fields.filter((f) => f.onCall).map((f) => f.key)));

export function fieldVisible(field: Field, answers: OnboardingAnswers): boolean {
  if (!field.showIf) return true;
  const value = answers[field.showIf.key];
  return typeof value === "string" && field.showIf.in.includes(value);
}

export function emptyTeamRow(partial: Partial<TeamRow> = {}): TeamRow {
  return { name: "", title: "", email: "", mobile: "", alerts: true, approves: false, finances: false, users: false, allRecords: false, ...partial };
}

/** The questions the client asked to leave for the call. */
export function askedOnCall(answers: OnboardingAnswers): Field[] {
  const keys = Array.isArray(answers[ASK_ON_CALL]) ? (answers[ASK_ON_CALL] as string[]) : [];
  return keys.map((k) => FIELD_BY_KEY.get(k)).filter((f): f is Field => Boolean(f));
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
 * `scope: "client"` keeps only what the client's form asks; the call sheet
 * ("all") can set every field.
 */
export function sanitizeAnswers(raw: unknown, scope: "client" | "all" = "all"): OnboardingAnswers {
  const input = obj(raw);
  const out: OnboardingAnswers = {};
  for (const field of FIELDS) {
    if (scope === "client" && !CLIENT_KEYS.has(field.key)) continue;
    const value = input[field.key];
    if (value === undefined || value === null) continue;
    switch (field.kind) {
      case "select":
      case "choice":
      case "cards": {
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
  const ask = input[ASK_ON_CALL];
  if (Array.isArray(ask)) out[ASK_ON_CALL] = [...new Set(ask.filter((k): k is string => typeof k === "string" && ASKABLE_KEYS.has(k)))];
  return out;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "a", "a and b", "a, b and c". */
export function joinWithAnd(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** The client-form fields still needed before it can be sent, with their step for the summary. */
export function missingRequired(answers: OnboardingAnswers): { stepId: string; stepTitle: string; label: string; short: string }[] {
  const missing: { stepId: string; stepTitle: string; label: string; short: string }[] = [];
  for (const step of CLIENT_STEPS) {
    for (const field of step.fields) {
      if (!field.required || !fieldVisible(field, answers)) continue;
      const value = answers[field.key];
      const filled = field.kind === "confirm" ? value === "yes" : typeof value === "string" && value.trim() !== "" && (field.kind !== "email" || EMAIL.test(value.trim()));
      if (!filled) missing.push({ stepId: step.id, stepTitle: step.title, label: field.label, short: field.short ?? field.label.toLowerCase() });
    }
  }
  return missing;
}

/** Answered fields over visible fields, per step of the given list (the client's steps by default). */
export function stepProgress(answers: OnboardingAnswers, steps: Step[] = CLIENT_STEPS): Record<string, { answered: number; total: number }> {
  const out: Record<string, { answered: number; total: number }> = {};
  for (const step of steps) {
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
    if (field.kind === "select" || field.kind === "choice" || field.kind === "cards") return field.options.find((o) => o.value === value)?.label ?? value;
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

/** The preset for a browser's own time zone, so the form can start with a good guess. */
export function presetTimezoneFor(browserZone: string | undefined): string | undefined {
  if (!browserZone) return undefined;
  if (REGION_PRESETS.some((p) => p.timezone === browserZone)) return browserZone;
  const sameAs: Record<string, string> = { "Australia/Melbourne": "Australia/Sydney", "Australia/Hobart": "Australia/Sydney", "Australia/Canberra": "Australia/Sydney", "Australia/ACT": "Australia/Sydney", "Australia/Lindeman": "Australia/Brisbane", "Pacific/Chatham": "Pacific/Auckland", "Europe/Belfast": "Europe/London", "America/Detroit": "America/New_York", "America/Toronto": "America/New_York", "America/Vancouver": "America/Los_Angeles" };
  return sameAs[browserZone];
}
