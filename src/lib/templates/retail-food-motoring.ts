import { automationsWith, contentModule, valuesFrom } from "./define";
import { genericTemplate, UNIVERSAL_MUST_NOT } from "./generic";
import type { IndustryTemplate } from "./types";

/** Cafés, restaurants, bars, venues and caterers: functions and events are the leads worth a person. */
export const hospitalityTemplate: IndustryTemplate = {
  key: "hospitality",
  industry: "GENERIC",
  name: "Café, restaurant & venue",
  group: "Retail, food and motoring",
  examples: "Cafés, restaurants, bars, function venues, catering, events",
  summary: "Function and event enquiries to deposit paid. Table bookings and menu questions are answered for you; posts land around mealtimes.",
  roles: genericTemplate.roles,
  pipelines: [
    {
      key: "functions",
      name: "Functions and events",
      isDefault: true,
      stages: [
        { key: "enquiry", name: "Enquiry" },
        { key: "walkthrough", name: "Walkthrough or tasting booked", advanceOn: "BOOKING_CREATED" },
        { key: "quoted", name: "Quote sent", quietAfterDays: 3 },
        { key: "deposit", name: "Deposit paid", advanceOn: "PAYMENT_RECEIVED", isWon: true },
        { key: "lost", name: "Lost", isLost: true },
      ],
    },
  ],
  qualificationRules: {
    greenKeywords: ["function", "event", "private dining", "group booking", "catering", "wedding", "birthday", "corporate", "set menu"],
    redKeywords: ["job application", "supplier", "lost property", "complaint about"],
    highIntentServices: ["function", "catering", "private dining"],
    greenCriteria: ["wants a function, event, catering or a large group", "names a date or a number of guests"],
    autoHandled: ["table bookings for small groups", "opening hours", "menu, dietary and allergen questions", "job applications"],
    requirePhone: false,
  },
  sla: { firstResponseMinutes: 5, bookingWindowHours: 48, quietHours: { start: 22, end: 8 } },
  opportunityValues: valuesFrom({ enquiry: 80000, quote: 250000, lapsed: 30000 }),
  modules: [{ key: "leads" }, { key: "opportunities" }, { key: "automation" }, contentModule([[2, 11], [3, 17], [4, 11], [5, 16], [6, 9]]), { key: "social" }, { key: "finance" }],
  automations: automationsWith({
    review_request: { delayHours: 3 },
    reactivation: { inactiveDays: 120 },
    inbox_triage: { autoReplyRoutine: true },
  }),
  brand: {
    voice: "Inviting, generous and specific. Make people hungry. Name the dish, the night, the room.",
    bannedPhrases: [...genericTemplate.brand.bannedPhrases, "best in the world", "bottomless"],
    complianceBlock: {
      claimsPolicy: "Menus, prices and opening hours only from what the venue has on file.",
      mustNot: [...UNIVERSAL_MUST_NOT, "promise a dish is free of an allergen", "encourage heavy or rapid drinking"],
    },
  },
};

/** Shops and online stores: orders, stock and repeat customers. */
export const retailTemplate: IndustryTemplate = {
  key: "retail",
  industry: "GENERIC",
  name: "Retail & online store",
  group: "Retail, food and motoring",
  examples: "Shops, boutiques, e-commerce, florists, homewares",
  summary: "Enquiry to paid order, stock tracking, five posts a week and a win-back message after two quiet months.",
  roles: genericTemplate.roles,
  pipelines: [
    {
      key: "orders",
      name: "Orders and custom requests",
      isDefault: true,
      stages: [
        { key: "enquiry", name: "Enquiry" },
        { key: "quoted", name: "Quote or order sent", quietAfterDays: 3 },
        { key: "paid", name: "Paid", advanceOn: "PAYMENT_RECEIVED", isWon: true },
        { key: "lost", name: "Lost", isLost: true },
      ],
    },
  ],
  qualificationRules: {
    greenKeywords: ["in stock", "order", "buy", "custom", "bulk", "wholesale", "gift", "price"],
    redKeywords: ["job application", "supplier pitch", "influencer collab", "return label"],
    highIntentServices: ["custom order", "bulk order"],
    greenCriteria: ["wants to buy or order", "asks about a specific product, size or quantity"],
    autoHandled: ["order tracking and delivery questions", "returns and exchanges", "opening hours", "supplier and influencer pitches"],
    requirePhone: false,
  },
  sla: { firstResponseMinutes: 5, bookingWindowHours: 48, quietHours: { start: 21, end: 8 } },
  opportunityValues: valuesFrom({ enquiry: 15000, quote: 40000, lapsed: 20000 }),
  modules: [{ key: "leads" }, { key: "opportunities" }, { key: "automation" }, contentModule([[1, 12], [2, 19], [4, 12], [5, 19], [0, 10]]), { key: "social" }, { key: "ads" }, { key: "website" }, { key: "finance" }, { key: "inventory", settings: { types: ["STOCK"] } }],
  automations: automationsWith({
    booking_lifecycle: false,
    review_request: { delayHours: 96 },
    reactivation: { inactiveDays: 60 },
    inbox_triage: { autoReplyRoutine: true },
  }),
  brand: {
    voice: "Bright, friendly and product-proud. Show it, name it, price it.",
    bannedPhrases: [...genericTemplate.brand.bannedPhrases, "lowest price guaranteed", "while stocks last forever"],
    complianceBlock: {
      claimsPolicy: "Prices, sizes and stock only from the store's records. A 'was' price is shown only if it was genuinely charged.",
      mustNot: [...UNIVERSAL_MUST_NOT, "show a 'was' price that was never charged", "claim stock that is not on record"],
    },
  },
};

/** Dealers, mechanics, detailers: services come round again, and vehicle prices carry rules. */
export const automotiveTemplate: IndustryTemplate = {
  key: "automotive",
  industry: "GENERIC",
  name: "Automotive",
  group: "Retail, food and motoring",
  examples: "Mechanics, tyres, detailing, panel beaters, car dealers",
  summary: "Booked in, job done, paid. Service reminders after six months and the dealer or repairer licence on every asset.",
  licence: { required: false, label: "Licence line", placeholder: "Business Name | Dealer or repairer lic. 000000" },
  roles: genericTemplate.roles,
  pipelines: [
    {
      key: "jobs",
      name: "Services and sales",
      isDefault: true,
      stages: [
        { key: "enquiry", name: "Enquiry" },
        { key: "booked", name: "Booked in", advanceOn: "BOOKING_CREATED" },
        { key: "done", name: "Job done or test drive", advanceOn: "BOOKING_COMPLETED" },
        { key: "quoted", name: "Quote sent", quietAfterDays: 3 },
        { key: "paid", name: "Paid", advanceOn: "PAYMENT_RECEIVED", isWon: true },
        { key: "lost", name: "Lost", isLost: true },
      ],
    },
  ],
  qualificationRules: {
    greenKeywords: ["service", "book in", "repair", "quote", "rego", "tyres", "test drive", "finance", "trade-in"],
    redKeywords: ["job application", "parts supplier", "warranty claim"],
    highIntentServices: ["major service", "repair", "vehicle purchase"],
    greenCriteria: ["wants a vehicle serviced, repaired or bought", "gives a phone number", "names the vehicle"],
    autoHandled: ["opening hours", "parts supplier emails", "job applications"],
    requirePhone: true,
  },
  sla: { firstResponseMinutes: 5, bookingWindowHours: 48, quietHours: { start: 19, end: 7 } },
  opportunityValues: valuesFrom({ enquiry: 50000, quote: 150000, lapsed: 50000 }),
  modules: [{ key: "leads" }, { key: "opportunities" }, { key: "automation" }, contentModule([[1, 7], [3, 12], [5, 16]]), { key: "social" }, { key: "ads" }, { key: "finance" }, { key: "inventory", settings: { types: ["STOCK"] } }],
  automations: automationsWith({
    review_request: { delayHours: 6 },
    reactivation: { inactiveDays: 180 },
  }),
  brand: {
    voice: "Honest, practical and no-nonsense. Explain what was done and why, in plain words.",
    bannedPhrases: [...genericTemplate.brand.bannedPhrases, "unbeatable deal", "drive away today guaranteed"],
    complianceBlock: {
      requiredFooter: "",
      claimsPolicy: "A vehicle price states whether it is drive-away or excludes government charges. Service prices only from the published list.",
      mustNot: [...UNIVERSAL_MUST_NOT, "advertise a vehicle price without saying what it includes", "promise a repair time that is not booked"],
    },
  },
};
