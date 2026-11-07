import { automationsWith, contentModule, valuesFrom } from "./define";
import { genericTemplate, UNIVERSAL_MUST_NOT } from "./generic";
import type { IndustryTemplate } from "./types";

/** Accountants, lawyers, consultants: discovery call, proposal, engagement letter. */
export const professionalTemplate: IndustryTemplate = {
  key: "professional",
  industry: "GENERIC",
  name: "Professional services",
  group: "Professional and finance",
  examples: "Accountants, bookkeepers, lawyers, consultants, HR, recruiters",
  summary: "Discovery call, proposal, signed engagement. Chases missing documents, posts twice a week and never gives advice by message.",
  roles: [
    { key: "owner", name: "Principal", permissions: ["VIEW_FINANCES", "APPROVE_CONTENT", "RECEIVE_LEAD_ALERTS", "MANAGE_USERS", "VIEW_ALL_RECORDS"] },
    { key: "manager", name: "Practice manager", permissions: ["APPROVE_CONTENT", "RECEIVE_LEAD_ALERTS", "MANAGE_USERS", "VIEW_ALL_RECORDS"] },
    { key: "staff", name: "Adviser", permissions: ["RECEIVE_LEAD_ALERTS"] },
    { key: "team", name: "Team member", permissions: [] },
    { key: "accountant", name: "External accountant", permissions: ["VIEW_FINANCES"] },
  ],
  pipelines: [
    {
      key: "clients",
      name: "New clients",
      isDefault: true,
      stages: [
        { key: "enquiry", name: "Enquiry" },
        { key: "call_booked", name: "Discovery call booked", advanceOn: "BOOKING_CREATED" },
        { key: "call_done", name: "Discovery call done", advanceOn: "BOOKING_COMPLETED" },
        { key: "proposal", name: "Proposal sent", quietAfterDays: 7 },
        { key: "engaged", name: "Engagement signed", advanceOn: "DOCUMENT_SIGNED", isWon: true },
        { key: "lost", name: "Lost", isLost: true },
      ],
    },
  ],
  qualificationRules: {
    greenKeywords: ["engage", "quote", "proposal", "new client", "switch accountant", "help with", "consultation", "fees"],
    redKeywords: ["job application", "graduate", "free advice", "software vendor", "partnership offer"],
    highIntentServices: ["ongoing engagement", "consultation"],
    greenCriteria: ["is a business or person who needs the service", "describes a real matter or need", "gives a way to be contacted"],
    autoHandled: ["vendor and software pitches", "job applications", "requests for free one-off advice"],
    requirePhone: false,
  },
  sla: { firstResponseMinutes: 15, bookingWindowHours: 72, quietHours: { start: 19, end: 8 } },
  opportunityValues: valuesFrom({ enquiry: 150000, quote: 500000, lapsed: 200000 }),
  modules: [{ key: "leads" }, { key: "opportunities" }, { key: "automation" }, contentModule([[2, 8], [4, 8]]), { key: "social" }, { key: "website" }, { key: "finance" }],
  automations: automationsWith({
    chase_information: { chaseEveryDays: 3, maxChases: 3 },
    review_request: { delayHours: 72 },
    reactivation: { inactiveDays: 365 },
  }),
  brand: {
    voice: "Clear, measured and expert. Explain the why in plain English. Confident without overpromising.",
    bannedPhrases: [...genericTemplate.brand.bannedPhrases, "guaranteed result", "save thousands"],
    complianceBlock: {
      claimsPolicy: "General information only. Specific advice happens in an engagement, never in a post or message.",
      mustNot: [...UNIVERSAL_MUST_NOT, "give specific legal, tax or financial advice in a message or post", "promise an outcome or a saving"],
    },
  },
};

/** Mortgage and finance brokers, advisers, insurers: licensed, rate-sensitive, document-heavy. */
export const financeTemplate: IndustryTemplate = {
  key: "finance",
  industry: "GENERIC",
  name: "Mortgage & finance broker",
  group: "Professional and finance",
  examples: "Mortgage brokers, car and business finance, financial advisers, insurance",
  summary: "Call, fact find, application, settled. Chases documents every two days, and carries the credit licence line on every asset.",
  licence: { required: true, label: "Licence line", placeholder: "Business Name | Australian Credit Licence 000000" },
  roles: [
    { key: "owner", name: "Principal broker", permissions: ["VIEW_FINANCES", "APPROVE_CONTENT", "RECEIVE_LEAD_ALERTS", "MANAGE_USERS", "VIEW_ALL_RECORDS"] },
    { key: "manager", name: "Office manager", permissions: ["APPROVE_CONTENT", "RECEIVE_LEAD_ALERTS", "MANAGE_USERS", "VIEW_ALL_RECORDS"] },
    { key: "staff", name: "Broker", permissions: ["RECEIVE_LEAD_ALERTS"] },
    { key: "team", name: "Loan processor", permissions: [] },
    { key: "accountant", name: "External accountant", permissions: ["VIEW_FINANCES"] },
  ],
  pipelines: [
    {
      key: "loans",
      name: "Loans",
      isDefault: true,
      stages: [
        { key: "enquiry", name: "Enquiry" },
        { key: "call_booked", name: "Call booked", advanceOn: "BOOKING_CREATED" },
        { key: "fact_find", name: "Fact find done", advanceOn: "BOOKING_COMPLETED" },
        { key: "lodged", name: "Application lodged", quietAfterDays: 7 },
        { key: "settled", name: "Settled", isWon: true },
        { key: "lost", name: "Lost", isLost: true },
      ],
    },
  ],
  qualificationRules: {
    greenKeywords: ["home loan", "refinance", "pre-approval", "borrow", "first home", "investment loan", "rate", "car loan", "business loan"],
    redKeywords: ["job application", "lead seller", "debt collection", "hardship"],
    highIntentServices: ["pre-approval", "refinance", "purchase"],
    greenCriteria: ["wants to borrow, refinance or get pre-approved", "gives a phone number", "names a property, amount or timeframe"],
    autoHandled: ["lead-seller and vendor pitches", "job applications", "existing-loan servicing questions for the lender"],
    requirePhone: true,
  },
  sla: { firstResponseMinutes: 5, bookingWindowHours: 48, quietHours: { start: 20, end: 8 } },
  opportunityValues: valuesFrom({ enquiry: 200000, quote: 400000, lapsed: 250000 }),
  modules: [{ key: "leads" }, { key: "opportunities" }, { key: "automation" }, contentModule([[1, 7], [3, 12], [5, 7]]), { key: "social" }, { key: "ads" }, { key: "website" }, { key: "finance" }],
  automations: automationsWith({
    chase_information: { chaseEveryDays: 2, maxChases: 4 },
    review_request: { delayHours: 48 },
    reactivation: { inactiveDays: 365 },
  }),
  brand: {
    voice: "Reassuring, clear and on the borrower's side. Make the next step obvious. Never pushy.",
    bannedPhrases: [...genericTemplate.brand.bannedPhrases, "guaranteed approval", "lowest rate guaranteed", "bad credit no problem"],
    complianceBlock: {
      requiredFooter: "",
      claimsPolicy: "Any interest rate shown carries its comparison rate and is current on the day. Approval is never promised.",
      mustNot: [...UNIVERSAL_MUST_NOT, "quote an interest rate without its comparison rate", "promise approval or a rate", "give personal financial advice in a post or message"],
    },
  },
};
