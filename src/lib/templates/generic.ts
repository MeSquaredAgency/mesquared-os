import { ROLE_TEMPLATES } from "@/lib/auth/permissions";
import type { IndustryTemplate } from "./types";

/** Universal compliance defaults every template inherits. */
export const UNIVERSAL_MUST_NOT = ["invent statistics or results", "use stale numbers or dates", "use hype or pressure language", "pose as a human when a message is automated"];

export const genericTemplate: IndustryTemplate = {
  key: "generic",
  industry: "GENERIC",
  name: "General business",
  roles: ROLE_TEMPLATES,
  pipelines: [
    {
      key: "default",
      name: "Sales",
      isDefault: true,
      stages: [
        { key: "enquiry", name: "Enquiry" },
        { key: "booked", name: "Consultation booked", advanceOn: "BOOKING_CREATED" },
        { key: "consulted", name: "Consultation done", advanceOn: "BOOKING_COMPLETED" },
        { key: "quoted", name: "Quote sent", quietAfterDays: 5 },
        { key: "won", name: "Paid", advanceOn: "PAYMENT_RECEIVED", isWon: true },
        { key: "lost", name: "Lost", isLost: true },
      ],
    },
  ],
  qualificationRules: {
    greenCriteria: ["wants to buy, book or get a quote", "gives a way to be contacted"],
    autoHandled: ["invoice and supplier emails", "job applications", "vendor pitches", "newsletter requests"],
    requirePhone: false,
  },
  sla: { firstResponseMinutes: 5, bookingWindowHours: 48, quietHours: { start: 21, end: 8 } },
  opportunityValues: {
    UNANSWERED_ENQUIRY: 50000,
    MISSED_CALL: 50000,
    ABANDONED_FORM: 25000,
    NOT_BOOKED: 50000,
    NO_SHOW: 50000,
    QUIET_QUOTE: 100000,
    UNREPLIED_DM: 20000,
    UNREPLIED_COMMENT: 5000,
    UNANSWERED_REVIEW: 10000,
    LAPSED_CUSTOMER: 50000,
  },
  modules: [{ key: "leads" }, { key: "opportunities" }, { key: "automation" }, { key: "content", settings: { postsPerWeek: 3, slots: [{ day: 1, hour: 9 }, { day: 3, hour: 9 }, { day: 5, hour: 10 }] } }, { key: "social" }],
  automations: [
    { key: "enquiry_auto_reply" },
    { key: "booking_lifecycle", settings: { reminderHoursBefore: 24, followUpHoursAfter: 24 } },
    { key: "review_request", settings: { delayHours: 3 } },
    { key: "reactivation", settings: { inactiveDays: 90 } },
    { key: "sla_watch", settings: { unrepliedInboxMinutes: 120, unansweredReviewHours: 48 } },
    { key: "content_engine", settings: { draftFromReviews: true, minReviewRating: 4 } },
    { key: "social_publish" },
    { key: "social_sync" },
    { key: "inbox_triage", settings: { autoReplyRoutine: false } },
    { key: "messaging" },
  ],
  brand: {
    voice: "Warm, plain and confident. Short sentences. Speak to one person. No jargon.",
    bannedPhrases: ["game-changing", "unlock", "revolutionary", "limited time only"],
    complianceBlock: { mustNot: UNIVERSAL_MUST_NOT },
  },
};
