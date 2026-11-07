import { automationsWith, contentModule, valuesFrom } from "./define";
import { genericTemplate, UNIVERSAL_MUST_NOT } from "./generic";
import type { IndustryTemplate } from "./types";

/** Plumbers, electricians, cleaners, landscapers: fast, local, phone-first, quoted after a look. */
export const tradesTemplate: IndustryTemplate = {
  key: "trades",
  industry: "GENERIC",
  name: "Trades & home services",
  group: "Home and building",
  examples: "Plumbing, electrical, HVAC, cleaning, landscaping, pest control",
  summary: "Phone-first jobs: site visit, quote, won. Missed calls get a text back and quiet quotes are chased after four days.",
  licence: { required: true, label: "Licence line", placeholder: "Business Name | Lic. 000000" },
  roles: genericTemplate.roles,
  pipelines: [
    {
      key: "jobs",
      name: "Jobs",
      isDefault: true,
      stages: [
        { key: "enquiry", name: "Enquiry" },
        { key: "visit_booked", name: "Site visit booked", advanceOn: "BOOKING_CREATED" },
        { key: "visit_done", name: "Site visit done", advanceOn: "BOOKING_COMPLETED" },
        { key: "quoted", name: "Quote sent", quietAfterDays: 4 },
        { key: "won", name: "Job won", advanceOn: "PAYMENT_RECEIVED", isWon: true },
        { key: "lost", name: "Lost", isLost: true },
      ],
    },
  ],
  qualificationRules: {
    greenKeywords: ["quote", "urgent", "leak", "blocked", "no power", "install", "replace", "repair", "booking", "come out"],
    redKeywords: ["job application", "apprenticeship", "subcontract", "supplier", "warranty claim"],
    highIntentServices: ["emergency call-out", "installation", "quote"],
    greenCriteria: ["needs a job done at a property in a service area", "gives a phone number or address", "says it is urgent or names a date"],
    autoHandled: ["supplier and trade account emails", "job applications", "opening hours and call-out fee questions"],
    requirePhone: true,
    serviceAreas: [],
  },
  sla: { firstResponseMinutes: 5, bookingWindowHours: 24, quietHours: { start: 20, end: 7 } },
  opportunityValues: valuesFrom({ enquiry: 60000, quote: 250000, lapsed: 40000 }),
  modules: [{ key: "leads" }, { key: "opportunities" }, { key: "automation" }, contentModule([[1, 7], [3, 7], [5, 12]]), { key: "social" }, { key: "ads" }, { key: "finance" }],
  automations: automationsWith({
    booking_lifecycle: { reminderHoursBefore: 18, followUpHoursAfter: 24 },
    review_request: { delayHours: 24 },
    reactivation: { inactiveDays: 365 },
  }),
  brand: {
    voice: "Straight-talking, reliable and local. Say when someone can come and what happens next. No fluff.",
    bannedPhrases: [...genericTemplate.brand.bannedPhrases, "cheapest in town", "no job too big"],
    complianceBlock: {
      requiredFooter: "",
      claimsPolicy: "Only quote prices, call-out fees and timeframes the business has set on file.",
      mustNot: [...UNIVERSAL_MUST_NOT, "give a firm price before a site visit or written quote", "promise an arrival time that is not booked"],
    },
  },
};

/** Builders, renovators, designers: long cycles, big contracts, staged sign-off. */
export const constructionTemplate: IndustryTemplate = {
  key: "construction",
  industry: "GENERIC",
  name: "Building & renovation",
  group: "Home and building",
  examples: "Builders, renovators, kitchens and bathrooms, architects, pools",
  summary: "Consultation, design and quote, signed contract. Long quote windows, project-photo posts and the licence line on every asset.",
  licence: { required: true, label: "Licence line", placeholder: "Business Name | Builder Lic. 000000" },
  roles: genericTemplate.roles,
  pipelines: [
    {
      key: "projects",
      name: "Projects",
      isDefault: true,
      stages: [
        { key: "enquiry", name: "Enquiry" },
        { key: "consult_booked", name: "Consultation booked", advanceOn: "BOOKING_CREATED" },
        { key: "consult_done", name: "Consultation done", advanceOn: "BOOKING_COMPLETED" },
        { key: "quoted", name: "Design and quote sent", quietAfterDays: 10 },
        { key: "signed", name: "Contract signed", advanceOn: "DOCUMENT_SIGNED", isWon: true },
        { key: "lost", name: "Lost", isLost: true },
      ],
    },
  ],
  qualificationRules: {
    greenKeywords: ["renovation", "extension", "new build", "knock down", "rebuild", "kitchen", "bathroom", "plans", "budget"],
    redKeywords: ["job application", "subcontract", "supplier", "handyman", "small repair"],
    highIntentServices: ["new home", "extension", "renovation"],
    greenCriteria: ["owns or is buying the property", "has a project in a service area", "mentions a budget or timeframe"],
    autoHandled: ["supplier and trade quotes", "job applications", "small repairs the business does not take on"],
    requirePhone: true,
    serviceAreas: [],
  },
  sla: { firstResponseMinutes: 5, bookingWindowHours: 72, quietHours: { start: 20, end: 7 } },
  opportunityValues: valuesFrom({ enquiry: 300000, quote: 1500000, lapsed: 100000 }),
  modules: [{ key: "leads" }, { key: "opportunities" }, { key: "automation" }, contentModule([[2, 8], [4, 8], [6, 9]]), { key: "social" }, { key: "ads" }, { key: "website" }, { key: "finance" }],
  automations: automationsWith({
    booking_lifecycle: { reminderHoursBefore: 24, followUpHoursAfter: 24 },
    chase_information: { chaseEveryDays: 4, maxChases: 3 },
    review_request: { delayHours: 72 },
    reactivation: { inactiveDays: 730 },
  }),
  brand: {
    voice: "Proud of the work, honest about cost and time. Show finished projects. Plain words, no trade jargon.",
    bannedPhrases: [...genericTemplate.brand.bannedPhrases, "fixed price guaranteed", "cheapest builder"],
    complianceBlock: {
      requiredFooter: "",
      claimsPolicy: "Only show projects the business built, with the owner's consent. Prices and timeframes only from a signed contract or a published rate.",
      mustNot: [...UNIVERSAL_MUST_NOT, "promise a completion date or fixed price outside a contract", "show another builder's work"],
    },
  },
};
