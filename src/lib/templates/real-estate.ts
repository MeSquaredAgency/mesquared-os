import type { IndustryTemplate } from "./types";
import { genericTemplate, UNIVERSAL_MUST_NOT } from "./generic";

/**
 * Real estate agencies doing property management and sales. The anchor
 * client seeds this template; nothing client-specific lives here. Licence
 * numbers, trading names and service areas are entered per tenant.
 */
export const realEstateTemplate: IndustryTemplate = {
  key: "real_estate",
  industry: "REAL_ESTATE",
  name: "Real estate agency",
  roles: [
    { key: "owner", name: "Director", permissions: ["VIEW_FINANCES", "APPROVE_CONTENT", "RECEIVE_LEAD_ALERTS", "MANAGE_USERS", "VIEW_ALL_RECORDS"] },
    { key: "manager", name: "Region Manager", permissions: ["APPROVE_CONTENT", "RECEIVE_LEAD_ALERTS", "MANAGE_USERS", "VIEW_ALL_RECORDS"] },
    { key: "staff", name: "Property Manager", permissions: ["RECEIVE_LEAD_ALERTS"] },
    { key: "accountant", name: "External accountant", permissions: ["VIEW_FINANCES"] },
  ],
  pipelines: [
    {
      key: "management",
      name: "Property management",
      isDefault: true,
      stages: [
        { key: "enquiry", name: "Enquiry" },
        { key: "appraisal_booked", name: "Appraisal booked", advanceOn: "BOOKING_CREATED" },
        { key: "appraisal_done", name: "Appraisal done", advanceOn: "BOOKING_COMPLETED" },
        { key: "agreement_sent", name: "Agreement sent", quietAfterDays: 4 },
        { key: "signed", name: "Signed", advanceOn: "DOCUMENT_SIGNED", isWon: true },
        { key: "lost", name: "Lost", isLost: true },
      ],
    },
    {
      key: "sales",
      name: "Sales",
      stages: [
        { key: "appraisal", name: "Appraisal", advanceOn: "BOOKING_CREATED" },
        { key: "listing_agreement", name: "Listing agreement", advanceOn: "DOCUMENT_SIGNED", quietAfterDays: 5 },
        { key: "listed", name: "Listed" },
        { key: "sold", name: "Sold", advanceOn: "PAYMENT_RECEIVED", isWon: true },
        { key: "withdrawn", name: "Withdrawn", isLost: true },
      ],
    },
  ],
  qualificationRules: {
    greenKeywords: ["appraisal", "manage my property", "property management", "sell", "selling", "landlord", "investment property", "rent out"],
    redKeywords: ["looking to rent", "rental application", "inspection time", "maintenance", "repair", "bond refund"],
    highIntentServices: ["appraisal", "property management", "sale"],
    greenCriteria: ["is a property owner in a service area", "wants management, an appraisal or a sale", "gives a phone number"],
    autoHandled: ["tenant and renter enquiries", "availability questions", "inspection requests", "rental applications"],
    requirePhone: true,
    serviceAreas: [],
  },
  sla: { firstResponseMinutes: 5, bookingWindowHours: 72, quietHours: { start: 20, end: 8 } },
  opportunityValues: {
    UNANSWERED_ENQUIRY: 180000,
    MISSED_CALL: 180000,
    ABANDONED_FORM: 60000,
    NOT_BOOKED: 180000,
    NO_SHOW: 180000,
    QUIET_QUOTE: 350000,
    UNREPLIED_DM: 60000,
    UNREPLIED_COMMENT: 10000,
    UNANSWERED_REVIEW: 25000,
    LAPSED_CUSTOMER: 180000,
  },
  modules: [
    { key: "leads" },
    { key: "opportunities" },
    { key: "automation" },
    { key: "content", settings: { postsPerWeek: 4, slots: [{ day: 1, hour: 9 }, { day: 2, hour: 17 }, { day: 4, hour: 9 }, { day: 6, hour: 8 }] } },
    { key: "social" },
    { key: "ads" },
    { key: "website" },
    { key: "inventory", settings: { types: ["LISTING"], rentRoll: true } },
  ],
  automations: [
    { key: "enquiry_auto_reply", settings: { renterReply: true, missedCallReply: true } },
    { key: "booking_lifecycle", settings: { kind: "inspection_and_appraisal", reminderHoursBefore: 24, followUpHoursAfter: 24 } },
    { key: "chase_information", settings: { applications: true, chaseEveryDays: 2, maxChases: 3 } },
    { key: "review_request", settings: { delayHours: 3 } },
    { key: "sla_watch", settings: { unrepliedInboxMinutes: 120, unansweredReviewHours: 48 } },
    { key: "content_engine", settings: { draftFromReviews: true, minReviewRating: 4 } },
    { key: "social_publish" },
    { key: "social_sync" },
    { key: "inbox_triage", settings: { autoReplyRoutine: false } },
    { key: "messaging" },
  ],
  brand: {
    voice: "Local, knowledgeable and calm. Plain English for owners and investors. No hard sell.",
    bannedPhrases: [...genericTemplate.brand.bannedPhrases, "guaranteed rent", "best price ever"],
    complianceBlock: {
      requiredFooter: "",
      prohibitedCombinations: ["separate vendors in one asset"],
      claimsPolicy: "Only state sale prices, yields and rents that come from a record on file.",
      mustNot: [...UNIVERSAL_MUST_NOT, "combine separate vendors or properties in one asset"],
    },
  },
};
