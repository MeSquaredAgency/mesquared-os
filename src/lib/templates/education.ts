import { automationsWith, contentModule, valuesFrom } from "./define";
import { genericTemplate, UNIVERSAL_MUST_NOT } from "./generic";
import type { IndustryTemplate } from "./types";

/** Tutoring, training, childcare and early learning: families decide slowly and places are limited. */
export const educationTemplate: IndustryTemplate = {
  key: "education",
  industry: "GENERIC",
  name: "Education & childcare",
  group: "Education and community",
  examples: "Tutoring, music and dance schools, training providers, childcare, early learning",
  summary: "Tour or trial, offer, enrolled. Tracks places by class or room, and never shows a child without written consent.",
  roles: genericTemplate.roles,
  pipelines: [
    {
      key: "enrolments",
      name: "Enrolments",
      isDefault: true,
      stages: [
        { key: "enquiry", name: "Enquiry" },
        { key: "tour_booked", name: "Tour or trial booked", advanceOn: "BOOKING_CREATED" },
        { key: "tour_done", name: "Tour or trial done", advanceOn: "BOOKING_COMPLETED" },
        { key: "offered", name: "Place offered", quietAfterDays: 5 },
        { key: "enrolled", name: "Enrolled", advanceOn: "PAYMENT_RECEIVED", isWon: true },
        { key: "lost", name: "Lost", isLost: true },
      ],
    },
  ],
  qualificationRules: {
    greenKeywords: ["enrol", "enrolment", "tour", "trial lesson", "vacancy", "place", "waitlist", "start date", "fees"],
    redKeywords: ["job application", "educator role", "supplier", "curriculum vendor"],
    highIntentServices: ["enrolment", "trial lesson", "tour"],
    greenCriteria: ["a parent or student wants a place or a trial", "names an age, year level or start date"],
    autoHandled: ["term dates and opening hours", "fee schedule questions", "job applications"],
    requirePhone: false,
  },
  sla: { firstResponseMinutes: 5, bookingWindowHours: 72, quietHours: { start: 19, end: 8 } },
  opportunityValues: valuesFrom({ enquiry: 100000, quote: 300000, lapsed: 80000 }),
  modules: [{ key: "leads" }, { key: "opportunities" }, { key: "automation" }, contentModule([[1, 8], [3, 15], [5, 8]]), { key: "social" }, { key: "website" }, { key: "finance" }, { key: "inventory", settings: { types: ["CAPACITY"] } }],
  automations: automationsWith({
    chase_information: { chaseEveryDays: 3, maxChases: 3 },
    review_request: { delayHours: 72 },
    reactivation: { inactiveDays: 120 },
  }),
  brand: {
    voice: "Warm, trustworthy and encouraging. Speak to parents as partners. Celebrate progress, not pressure.",
    bannedPhrases: [...genericTemplate.brand.bannedPhrases, "guaranteed grades", "genius"],
    complianceBlock: {
      claimsPolicy: "Results only as a student or family has shared them, with consent. Places and fees only from what is on file.",
      mustNot: [...UNIVERSAL_MUST_NOT, "show a child's face or name without written consent", "promise grades, results or a place that is not available"],
    },
  },
};
