import type { IndustryTemplate } from "./types";
import { genericTemplate, UNIVERSAL_MUST_NOT } from "./generic";

/** Gyms, studios and allied health. Membership and class capacity matter; claims need care. */
export const healthFitnessTemplate: IndustryTemplate = {
  key: "health_fitness",
  industry: "HEALTH_FITNESS",
  name: "Health & fitness",
  roles: genericTemplate.roles,
  pipelines: [
    {
      key: "membership",
      name: "Memberships",
      isDefault: true,
      stages: [
        { key: "enquiry", name: "Enquiry" },
        { key: "trial_booked", name: "Trial booked", advanceOn: "BOOKING_CREATED" },
        { key: "trial_done", name: "Trial done", advanceOn: "BOOKING_COMPLETED" },
        { key: "offer", name: "Offer made" },
        { key: "member", name: "Member", advanceOn: "PAYMENT_RECEIVED", isWon: true },
        { key: "lost", name: "Lost", isLost: true },
      ],
    },
  ],
  qualificationRules: {
    greenKeywords: ["join", "membership", "trial", "personal training", "class", "sign up", "start"],
    redKeywords: ["cancel membership", "freeze", "invoice", "lost property", "job"],
    highIntentServices: ["membership", "personal training", "trial"],
    greenCriteria: ["wants to join, trial or train", "is within travelling distance"],
    autoHandled: ["opening hours", "class timetable questions", "freeze and cancellation requests"],
    requirePhone: false,
  },
  sla: { firstResponseMinutes: 5, bookingWindowHours: 48, quietHours: { start: 21, end: 7 } },
  opportunityValues: {
    UNANSWERED_ENQUIRY: 90000,
    MISSED_CALL: 90000,
    ABANDONED_FORM: 30000,
    NOT_BOOKED: 90000,
    NO_SHOW: 90000,
    QUIET_QUOTE: 60000,
    UNREPLIED_DM: 30000,
    UNREPLIED_COMMENT: 5000,
    UNANSWERED_REVIEW: 15000,
    LAPSED_CUSTOMER: 120000,
  },
  modules: [
    { key: "leads" },
    { key: "opportunities" },
    { key: "automation" },
    { key: "content" },
    { key: "social" },
    { key: "finance" },
    { key: "inventory", settings: { types: ["CAPACITY"] } },
  ],
  automations: [{ key: "enquiry_auto_reply" }, { key: "booking_lifecycle" }, { key: "review_request" }, { key: "reactivation" }, { key: "payment_reminders" }, { key: "sla_watch" }],
  brand: {
    voice: "Encouraging and down to earth. Celebrate members. Never shame.",
    bannedPhrases: [...genericTemplate.brand.bannedPhrases, "lose 10kg in 10 days", "no excuses"],
    complianceBlock: {
      claimsPolicy: "No health outcome claims beyond what a member has said in their own words with consent.",
      mustNot: [...UNIVERSAL_MUST_NOT, "make medical or weight-loss promises"],
    },
  },
};
