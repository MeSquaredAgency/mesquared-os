import { automationsWith, contentModule, valuesFrom } from "./define";
import { genericTemplate, UNIVERSAL_MUST_NOT } from "./generic";
import type { IndustryTemplate } from "./types";

/**
 * Medical, dental and allied health. Regulated health advertising: no
 * testimonials, no outcome promises, no clinical advice by message. Review
 * requests start off; the practice decides whether to switch them on.
 */
export const clinicTemplate: IndustryTemplate = {
  key: "clinic",
  industry: "HEALTH_FITNESS",
  name: "Clinic & allied health",
  group: "Health and beauty",
  examples: "GPs, dentists, physio, chiro, psychology, specialists",
  summary: "New patients into first appointments and care plans. Written for health advertising rules: no testimonials, no outcome claims, no advice by message.",
  licence: { required: false, label: "Registration line", placeholder: "Practice Name | Practitioner reg. 0000000000" },
  roles: [
    { key: "owner", name: "Practice owner", permissions: ["VIEW_FINANCES", "APPROVE_CONTENT", "RECEIVE_LEAD_ALERTS", "MANAGE_USERS", "VIEW_ALL_RECORDS"] },
    { key: "manager", name: "Practice manager", permissions: ["APPROVE_CONTENT", "RECEIVE_LEAD_ALERTS", "MANAGE_USERS", "VIEW_ALL_RECORDS"] },
    { key: "staff", name: "Practitioner", permissions: ["RECEIVE_LEAD_ALERTS"] },
    { key: "team", name: "Reception", permissions: ["RECEIVE_LEAD_ALERTS"] },
    { key: "accountant", name: "External accountant", permissions: ["VIEW_FINANCES"] },
  ],
  pipelines: [
    {
      key: "patients",
      name: "New patients",
      isDefault: true,
      stages: [
        { key: "enquiry", name: "Enquiry" },
        { key: "booked", name: "First appointment booked", advanceOn: "BOOKING_CREATED" },
        { key: "seen", name: "First appointment done", advanceOn: "BOOKING_COMPLETED" },
        { key: "plan", name: "Care plan offered", quietAfterDays: 7 },
        { key: "ongoing", name: "Ongoing patient", isWon: true },
        { key: "lost", name: "Did not continue", isLost: true },
      ],
    },
  ],
  qualificationRules: {
    greenKeywords: ["appointment", "book", "new patient", "consult", "assessment", "referral", "pain", "check-up"],
    redKeywords: ["prescription repeat", "medical records", "invoice", "job", "locum"],
    highIntentServices: ["new patient appointment", "assessment"],
    greenCriteria: ["wants to book as a new or returning patient", "gives a way to be contacted"],
    autoHandled: ["opening hours and location", "fees and rebate questions", "records and admin requests"],
    requirePhone: false,
    notes: "Never answer a clinical question by message. Anything that sounds urgent is told to call the practice, or emergency services if it is an emergency.",
  },
  sla: { firstResponseMinutes: 5, bookingWindowHours: 48, quietHours: { start: 19, end: 8 } },
  opportunityValues: valuesFrom({ enquiry: 40000, quote: 120000, lapsed: 60000 }),
  modules: [{ key: "leads" }, { key: "opportunities" }, { key: "automation" }, contentModule([[1, 8], [4, 12]]), { key: "social" }, { key: "website" }, { key: "finance" }],
  automations: automationsWith({
    review_request: false,
    content_engine: { draftFromReviews: false },
    reactivation: { inactiveDays: 180 },
  }),
  brand: {
    voice: "Calm, caring and precise. Explain, never alarm. Plain language a patient understands.",
    bannedPhrases: [...genericTemplate.brand.bannedPhrases, "cure", "pain-free guaranteed", "miracle"],
    complianceBlock: {
      claimsPolicy: "Health advertising rules apply: no testimonials or reviews in advertising, no promise of outcomes, no comparison with other practitioners.",
      mustNot: [...UNIVERSAL_MUST_NOT, "use patient testimonials or reviews in advertising", "promise or imply a health outcome", "give clinical advice in a message", "offer a gift, discount or inducement without its terms"],
    },
  },
};

/** Salons, barbers, skin and nails: rebooking is the whole game. */
export const beautyTemplate: IndustryTemplate = {
  key: "beauty",
  industry: "GENERIC",
  name: "Salon, beauty & spa",
  group: "Health and beauty",
  examples: "Hair, barbers, nails, skin, lashes and brows, day spas",
  summary: "Bookings, visits and rebooking. Five posts a week, a review ask two hours after the visit, and a nudge after eight quiet weeks.",
  roles: genericTemplate.roles,
  pipelines: [
    {
      key: "bookings",
      name: "Bookings",
      isDefault: true,
      stages: [
        { key: "enquiry", name: "Enquiry" },
        { key: "booked", name: "Booked", advanceOn: "BOOKING_CREATED" },
        { key: "visited", name: "Visit done", advanceOn: "BOOKING_COMPLETED" },
        { key: "paid", name: "Paid", advanceOn: "PAYMENT_RECEIVED", isWon: true },
        { key: "lost", name: "Lost", isLost: true },
      ],
    },
  ],
  qualificationRules: {
    greenKeywords: ["book", "appointment", "available", "colour", "cut", "facial", "nails", "lashes", "bridal", "gift voucher"],
    redKeywords: ["job", "chair rental", "supplier", "product rep"],
    highIntentServices: ["bridal", "colour", "treatment package"],
    greenCriteria: ["wants to book a service", "names a day or time"],
    autoHandled: ["opening hours and prices", "product questions", "job and chair rental enquiries"],
    requirePhone: false,
  },
  sla: { firstResponseMinutes: 5, bookingWindowHours: 24, quietHours: { start: 21, end: 8 } },
  opportunityValues: valuesFrom({ enquiry: 15000, quote: 40000, lapsed: 30000 }),
  modules: [{ key: "leads" }, { key: "opportunities" }, { key: "automation" }, contentModule([[1, 10], [2, 18], [3, 10], [5, 11], [6, 9]]), { key: "social" }, { key: "finance" }],
  automations: automationsWith({
    booking_lifecycle: { reminderHoursBefore: 24, followUpHoursAfter: 48 },
    review_request: { delayHours: 2 },
    reactivation: { inactiveDays: 56 },
  }),
  brand: {
    voice: "Warm, upbeat and personal. Talk like the person behind the chair. Show the work.",
    bannedPhrases: [...genericTemplate.brand.bannedPhrases, "flawless forever", "anti-ageing miracle"],
    complianceBlock: {
      claimsPolicy: "Only show work done in the salon, with the client's consent. Cosmetic injectables follow health advertising rules.",
      mustNot: [...UNIVERSAL_MUST_NOT, "promise permanent or medical results", "edit photos of the work in a way that changes the result"],
    },
  },
};
