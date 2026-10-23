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
        { key: "quoted", name: "Quote sent" },
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
  modules: [{ key: "leads" }, { key: "opportunities" }, { key: "automation" }, { key: "content" }, { key: "social" }],
  automations: [{ key: "enquiry_auto_reply" }, { key: "booking_lifecycle" }, { key: "review_request" }, { key: "sla_watch" }],
  brand: {
    voice: "Warm, plain and confident. Short sentences. Speak to one person. No jargon.",
    bannedPhrases: ["game-changing", "unlock", "revolutionary", "limited time only"],
    complianceBlock: { mustNot: UNIVERSAL_MUST_NOT },
  },
};
