import { hashPasswordSync } from "@/lib/auth/password";
import { hashApiKey } from "@/lib/crypto";
import { materializeTemplate, type MaterializedTemplate } from "@/lib/templates/apply";
import { healthFitnessTemplate } from "@/lib/templates/health-fitness";
import { realEstateTemplate } from "@/lib/templates/real-estate";
import type {
  AutomationRunRecord,
  ContactRecord,
  ContentAssetRecord,
  ExceptionRecord,
  IntegrationRecord,
  LeadRecord,
  MissedOpportunityRecord,
  SocialPlatform,
  SocialPostRecord,
  TenantSummary,
  TransactionRecord,
  UserRecord,
} from "@/lib/types";

/**
 * Demo data used when DATABASE_URL is not set. Two fictional tenants, each
 * configured purely by applying an industry template, exactly as a real
 * tenant would be. Real client names and branding never appear here.
 */

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);
const ahead = (minutes: number) => new Date(Date.now() + minutes * 60_000);

let counter = 0;
const nextId = (prefix: string) => `${prefix}_${String(++counter).padStart(3, "0")}`;

// ---------------------------------------------------------------------------
// Tenants (from templates)
// ---------------------------------------------------------------------------

export const demoTenants: TenantSummary[] = [
  {
    id: "tenant_harbor",
    slug: "harbor-realty",
    name: "Harbor Realty Group",
    industry: "REAL_ESTATE",
    templateKey: "real_estate",
    region: "AU",
    timezone: "Australia/Adelaide",
    locale: "en-AU",
    currency: "AUD",
    branding: { primaryColor: "#0f4c81", fromName: "Harbor Realty" },
    qualificationRules: { ...realEstateTemplate.qualificationRules, serviceAreas: ["Adelaide", "Mount Gambier"] },
    sla: realEstateTemplate.sla,
    escalationRules: [],
    opportunityValues: realEstateTemplate.opportunityValues,
  },
  {
    id: "tenant_summit",
    slug: "summit-fitness",
    name: "Summit Health & Fitness",
    industry: "HEALTH_FITNESS",
    templateKey: "health_fitness",
    region: "AU",
    timezone: "Australia/Sydney",
    locale: "en-AU",
    currency: "AUD",
    branding: { primaryColor: "#c2410c", fromName: "Summit" },
    qualificationRules: healthFitnessTemplate.qualificationRules,
    sla: healthFitnessTemplate.sla,
    escalationRules: [],
    opportunityValues: healthFitnessTemplate.opportunityValues,
  },
];

export const demoConfig: Record<string, MaterializedTemplate> = {
  tenant_harbor: materializeTemplate(realEstateTemplate, "tenant_harbor", nextId),
  tenant_summit: materializeTemplate(healthFitnessTemplate, "tenant_summit", nextId),
};

const harborPipeline = demoConfig.tenant_harbor.pipelines[0];
const harborStage = (key: string) => harborPipeline.stages.find((s) => s.key === key)!.id;
const summitPipeline = demoConfig.tenant_summit.pipelines[0];
const summitStage = (key: string) => summitPipeline.stages.find((s) => s.key === key)!.id;
const roleId = (tenantId: string, templateKey: string) => demoConfig[tenantId].roles.find((r) => r.templateKey === templateKey)!.id;

// ---------------------------------------------------------------------------
// Users, memberships, operator assignments, API keys
// ---------------------------------------------------------------------------

export const DEMO_OPERATOR_EMAIL = "operator@example.com";

/** Every demo account signs in with DEMO_OPERATOR_PASSWORD (default "mesquared-demo"). */
export const DEMO_ACCOUNTS: { email: string; describes: string }[] = [
  { email: "operator@example.com", describes: "Me² platform admin (console, every tenant)" },
  { email: "ops@example.com", describes: "Me² operator assigned to both demo tenants" },
  { email: "director@harbor.example", describes: "Harbor Realty Director (portal, all permissions)" },
  { email: "pm@harbor.example", describes: "Harbor Realty Property Manager (portal, own leads only)" },
  { email: "owner@summit.example", describes: "Summit Health & Fitness Owner (portal)" },
];

type DemoUser = UserRecord & { passwordHash: string };
let cachedDemoUsers: DemoUser[] | null = null;

/** Hashing is deferred to first use so importing fixtures stays cheap. */
export function getDemoUsers(): DemoUser[] {
  if (cachedDemoUsers) return cachedDemoUsers;
  const passwordHash = hashPasswordSync(process.env.DEMO_OPERATOR_PASSWORD ?? "mesquared-demo");
  const base = { sessionVersion: 0, passwordHash };
  cachedDemoUsers = [
    { id: "user_admin", email: "operator@example.com", name: "Demo Admin", isOperator: true, isPlatformAdmin: true, ...base },
    { id: "user_ops", email: "ops@example.com", name: "Demo Operator", isOperator: true, isPlatformAdmin: false, ...base },
    { id: "user_director", email: "director@harbor.example", name: "Dana Harbor", isOperator: false, isPlatformAdmin: false, ...base },
    { id: "user_pm", email: "pm@harbor.example", name: "Priya Mehta", isOperator: false, isPlatformAdmin: false, ...base },
    { id: "user_summit_owner", email: "owner@summit.example", name: "Sam Okafor", isOperator: false, isPlatformAdmin: false, ...base },
  ];
  return cachedDemoUsers;
}

export const demoMemberships: { userId: string; tenantId: string; roleId: string }[] = [
  { userId: "user_director", tenantId: "tenant_harbor", roleId: roleId("tenant_harbor", "owner") },
  { userId: "user_pm", tenantId: "tenant_harbor", roleId: roleId("tenant_harbor", "staff") },
  { userId: "user_summit_owner", tenantId: "tenant_summit", roleId: roleId("tenant_summit", "owner") },
];

export const demoOperatorAssignments: { userId: string; tenantId: string }[] = [
  { userId: "user_ops", tenantId: "tenant_harbor" },
  { userId: "user_ops", tenantId: "tenant_summit" },
];

export const DEMO_API_KEYS: Record<string, string> = {
  tenant_harbor: "msq_live_demo_one_0000000000000000",
  tenant_summit: "msq_live_demo_two_0000000000000000",
};

export const demoApiKeyHashes: Record<string, string> = Object.fromEntries(
  Object.entries(DEMO_API_KEYS).map(([tenantId, raw]) => [hashApiKey(raw), tenantId]),
);

// ---------------------------------------------------------------------------
// Integrations and channels
// ---------------------------------------------------------------------------

/** Per-integration settings the adapters read (never credentials). Keyed by integration id. */
export const demoIntegrationSettings: Record<string, Record<string, unknown>> = {
  int_1: { eventTypeSlug: "harbor-realty/appraisal", calendar: "google" },
  int_2: { pageId: "page_1", instagramAccountId: "ig_1" },
  int_5: { domain: "harbor-realty.example", forms: ["contact", "appraisal"] },
  int_6: { fromNumber: "+61400000000", whatsapp: false },
  int_10: { inboxAddress: "intake+harbor-realty@inbound.mesquared.example", sources: ["REA", "DOMAIN"] },
  int_7: { pageId: "page_2" },
  int_8: { merchantId: "merchant_2" },
  int_9: { eventTypeSlug: "summit/trial" },
};

export const demoIntegrations: IntegrationRecord[] = [
  { id: "int_1", tenantId: "tenant_harbor", provider: "CALCOM", label: "Cal.com (Google Workspace)", status: "CONNECTED", externalAccountId: "harbor", lastSyncAt: ago(12), lastError: null },
  { id: "int_2", tenantId: "tenant_harbor", provider: "META", label: "Facebook & Instagram", status: "CONNECTED", externalAccountId: "page_1", lastSyncAt: ago(30), lastError: null },
  { id: "int_3", tenantId: "tenant_harbor", provider: "GOOGLE_ADS", label: "Google Ads", status: "NEEDS_ATTENTION", externalAccountId: "123-456", lastSyncAt: ago(60 * 26), lastError: "Token expired; reconnect required" },
  { id: "int_4", tenantId: "tenant_harbor", provider: "REA", label: "realestate.com.au emails", status: "PENDING", externalAccountId: null, lastSyncAt: null, lastError: null },
  { id: "int_5", tenantId: "tenant_harbor", provider: "WEBSITE", label: "Agency website forms", status: "CONNECTED", externalAccountId: "site_1", lastSyncAt: ago(3), lastError: null },
  { id: "int_6", tenantId: "tenant_harbor", provider: "TWILIO", label: "SMS", status: "CONNECTED", externalAccountId: "+61400000000", lastSyncAt: ago(3), lastError: null },
  { id: "int_10", tenantId: "tenant_harbor", provider: "EMAIL_FORWARDING", label: "Forwarding inbox (REA, Domain)", status: "CONNECTED", externalAccountId: "intake+harbor-realty@inbound.mesquared.example", lastSyncAt: ago(8), lastError: null },
  { id: "int_7", tenantId: "tenant_summit", provider: "META", label: "Facebook & Instagram", status: "CONNECTED", externalAccountId: "page_2", lastSyncAt: ago(45), lastError: null },
  { id: "int_8", tenantId: "tenant_summit", provider: "SQUARE", label: "Square", status: "CONNECTED", externalAccountId: "merchant_2", lastSyncAt: ago(20), lastError: null },
  { id: "int_9", tenantId: "tenant_summit", provider: "CALCOM", label: "Cal.com", status: "DISCONNECTED", externalAccountId: null, lastSyncAt: ago(60 * 24 * 3), lastError: "Calendar access revoked" },
];

export const demoConnectedPlatforms: Record<string, SocialPlatform[]> = {
  tenant_harbor: ["FACEBOOK", "INSTAGRAM", "YOUTUBE"],
  tenant_summit: ["FACEBOOK", "INSTAGRAM"],
};

/** Ad spend this month in minor units; stands in for the ads module until Phase 4. */
export const demoAdSpendMonthCents: Record<string, { spentCents: number; budgetCents: number }> = {
  tenant_harbor: { spentCents: 61_000, budgetCents: 100_000 },
};

// ---------------------------------------------------------------------------
// Contacts and leads
// ---------------------------------------------------------------------------

export const demoContacts: ContactRecord[] = [
  { id: "ct_1", tenantId: "tenant_harbor", firstName: "Margaret", lastName: "Ellis", email: "margaret.ellis@example.com", phone: "+61400111222", company: null, tags: ["owner"], lastActivityAt: ago(14), lapsedAt: null, createdAt: ago(14) },
  { id: "ct_2", tenantId: "tenant_harbor", firstName: "Peter", lastName: "Nguyen", email: "peter.n@example.com", phone: "+61400333444", company: null, tags: ["owner"], lastActivityAt: ago(95), lapsedAt: null, createdAt: ago(95) },
  { id: "ct_3", tenantId: "tenant_harbor", firstName: "Lucy", lastName: "Tran", email: "lucy.t@example.com", phone: null, company: null, tags: ["renter"], lastActivityAt: ago(40), lapsedAt: null, createdAt: ago(40) },
  { id: "ct_4", tenantId: "tenant_harbor", firstName: "Graham", lastName: "Steele", email: "g.steele@example.com", phone: "+61400555666", company: null, tags: ["owner"], lastActivityAt: ago(60 * 30), lapsedAt: null, createdAt: ago(60 * 30) },
  { id: "ct_5", tenantId: "tenant_harbor", firstName: "Ana", lastName: "Petrova", email: "ana.p@example.com", phone: "+61400777888", company: null, tags: ["owner"], lastActivityAt: ago(60 * 9), lapsedAt: null, createdAt: ago(60 * 9) },
  { id: "ct_6", tenantId: "tenant_summit", firstName: "Jordan", lastName: "Lee", email: "jordan.lee@example.com", phone: "+61411000111", company: null, tags: [], lastActivityAt: ago(22), lapsedAt: null, createdAt: ago(22) },
  { id: "ct_7", tenantId: "tenant_summit", firstName: "Chloe", lastName: "Baptiste", email: "chloe.b@example.com", phone: null, company: null, tags: [], lastActivityAt: ago(60 * 50), lapsedAt: ago(60 * 24), createdAt: ago(60 * 24 * 90) },
];

const baseLead = {
  attribution: {},
  firstResponseAt: null,
  bookedAt: null,
};

export const demoLeads: LeadRecord[] = [
  {
    ...baseLead,
    id: "lead_1",
    tenantId: "tenant_harbor",
    contactId: "ct_1",
    pipelineId: harborPipeline.id,
    stageId: harborStage("enquiry"),
    assigneeId: "user_pm",
    source: "META_LEAD_FORM",
    externalId: "fb_8841",
    firstName: "Margaret",
    lastName: "Ellis",
    email: "margaret.ellis@example.com",
    phone: "+61400111222",
    company: null,
    message: "I own two units in Glenelg and I'm not happy with my current manager. Can someone call me about managing them?",
    attributes: { suburb: "Glenelg", service: "property management" },
    attribution: { source: "facebook", campaign: "landlord-oct" },
    status: "QUALIFIED",
    ticketType: "GREEN",
    intentScore: 94,
    qualificationReason: "Owner in a service area asking for management with a phone number. Two properties.",
    qualifiedBy: "stub",
    valueCents: 360_000,
    respondBy: ago(9),
    bookBy: ahead(60 * 67),
    firstResponseAt: ago(13),
    createdAt: ago(14),
  },
  {
    ...baseLead,
    id: "lead_2",
    tenantId: "tenant_harbor",
    contactId: "ct_2",
    pipelineId: harborPipeline.id,
    stageId: harborStage("appraisal_booked"),
    assigneeId: "user_pm",
    source: "WEB_FORM",
    externalId: "web_2201",
    firstName: "Peter",
    lastName: "Nguyen",
    email: "peter.n@example.com",
    phone: "+61400333444",
    company: null,
    message: "Thinking of selling our place in Norwood next year. What's it worth?",
    attributes: { suburb: "Norwood", service: "appraisal" },
    attribution: { source: "google", campaign: "appraisal-search" },
    status: "BOOKED",
    ticketType: "GREEN",
    intentScore: 78,
    qualificationReason: "Owner asking for an appraisal in a service area; timeline next year.",
    qualifiedBy: "stub",
    valueCents: 350_000,
    respondBy: ago(90),
    bookBy: ago(23),
    firstResponseAt: ago(93),
    bookedAt: ago(70),
    createdAt: ago(95),
  },
  {
    ...baseLead,
    id: "lead_3",
    tenantId: "tenant_harbor",
    contactId: "ct_3",
    pipelineId: null,
    stageId: null,
    assigneeId: null,
    source: "PORTAL_EMAIL",
    externalId: "rea_7731",
    firstName: "Lucy",
    lastName: "Tran",
    email: "lucy.t@example.com",
    phone: null,
    company: null,
    message: "Is 12 Marine Parade still available? When is the next inspection?",
    attributes: { listing: "12 Marine Parade" },
    status: "NURTURING",
    ticketType: "RED",
    intentScore: 12,
    qualificationReason: "Renter availability enquiry; answered automatically with the next inspection time.",
    qualifiedBy: "stub",
    valueCents: 0,
    respondBy: null,
    bookBy: null,
    createdAt: ago(40),
  },
  {
    ...baseLead,
    id: "lead_4",
    tenantId: "tenant_harbor",
    contactId: "ct_5",
    pipelineId: harborPipeline.id,
    stageId: harborStage("enquiry"),
    assigneeId: null,
    source: "WEB_FORM",
    externalId: "web_9001",
    firstName: "Ana",
    lastName: "Petrova",
    email: "ana.p@example.com",
    phone: "+61400777888",
    company: null,
    message: "Looking for a manager for a townhouse in Mount Gambier. Currently self-managing.",
    attributes: { suburb: "Mount Gambier", service: "property management" },
    attribution: { source: "google", campaign: "landlord-oct" },
    status: "QUALIFIED",
    ticketType: "GREEN",
    intentScore: 88,
    qualificationReason: "Owner in a service area wants management; phone given.",
    qualifiedBy: "stub",
    valueCents: 180_000,
    respondBy: ago(60 * 9 - 5),
    bookBy: ago(60 * 3),
    firstResponseAt: ago(60 * 9 - 4),
    createdAt: ago(60 * 9),
  },
  {
    ...baseLead,
    id: "lead_5",
    tenantId: "tenant_summit",
    contactId: "ct_6",
    pipelineId: summitPipeline.id,
    stageId: summitStage("enquiry"),
    assigneeId: null,
    source: "META_LEAD_FORM",
    externalId: "fb_5120",
    firstName: "Jordan",
    lastName: "Lee",
    email: "jordan.lee@example.com",
    phone: "+61411000111",
    company: null,
    message: "Keen to start personal training, two sessions a week. Can I come in for a trial?",
    attributes: { service: "personal training" },
    attribution: { source: "instagram", campaign: "spring-trial" },
    status: "QUALIFIED",
    ticketType: "GREEN",
    intentScore: 91,
    qualificationReason: "Wants to trial and train twice weekly; phone given.",
    qualifiedBy: "stub",
    valueCents: 240_000,
    respondBy: ago(17),
    bookBy: ahead(60 * 46),
    firstResponseAt: ago(21),
    createdAt: ago(22),
  },
];

// ---------------------------------------------------------------------------
// Missed opportunities, automation runs, exceptions
// ---------------------------------------------------------------------------

export const demoMissed: MissedOpportunityRecord[] = [
  { id: "mo_1", tenantId: "tenant_harbor", type: "NOT_BOOKED", status: "ESCALATED", contactId: "ct_5", leadId: "lead_4", estimatedValueCents: 180_000, recoveredValueCents: 0, summary: "Ana Petrova was acknowledged but nothing was booked within 72 hours.", detectedAt: ago(60 * 3), resolvedAt: null },
  { id: "mo_2", tenantId: "tenant_harbor", type: "UNANSWERED_REVIEW", status: "DETECTED", contactId: null, leadId: null, estimatedValueCents: 25_000, recoveredValueCents: 0, summary: "A 4-star Google review from Thursday has no reply.", detectedAt: ago(60 * 20), resolvedAt: null },
  { id: "mo_3", tenantId: "tenant_harbor", type: "MISSED_CALL", status: "RECOVERED", contactId: "ct_4", leadId: null, estimatedValueCents: 180_000, recoveredValueCents: 180_000, summary: "Missed call from Graham Steele; called back within 20 minutes and an appraisal was booked.", detectedAt: ago(60 * 30), resolvedAt: ago(60 * 29) },
  { id: "mo_4", tenantId: "tenant_summit", type: "LAPSED_CUSTOMER", status: "RECOVERING", contactId: "ct_7", leadId: null, estimatedValueCents: 120_000, recoveredValueCents: 0, summary: "Chloe Baptiste hasn't visited in 7 weeks; reactivation message sent.", detectedAt: ago(60 * 24), resolvedAt: null },
];

export const demoRuns: AutomationRunRecord[] = [
  { id: "run_1", tenantId: "tenant_harbor", typeKey: "enquiry_auto_reply", outcome: "SENT", summary: "Acknowledged Margaret Ellis by SMS with a booking link.", leadId: "lead_1", contactId: "ct_1", missedOpportunityId: null, createdAt: ago(13) },
  { id: "run_2", tenantId: "tenant_harbor", typeKey: "enquiry_auto_reply", outcome: "SENT", summary: "Answered Lucy Tran's availability question for 12 Marine Parade and sent the next inspection time.", leadId: "lead_3", contactId: "ct_3", missedOpportunityId: null, createdAt: ago(39) },
  { id: "run_3", tenantId: "tenant_harbor", typeKey: "booking_lifecycle", outcome: "SENT", summary: "Reminded Peter Nguyen about tomorrow's appraisal.", leadId: "lead_2", contactId: "ct_2", missedOpportunityId: null, createdAt: ago(60 * 2) },
  { id: "run_4", tenantId: "tenant_harbor", typeKey: "sla_watch", outcome: "ESCALATED", summary: "Ana Petrova hasn't booked within 72 hours; raised for an operator.", leadId: "lead_4", contactId: "ct_5", missedOpportunityId: "mo_1", createdAt: ago(60 * 3) },
  { id: "run_5", tenantId: "tenant_harbor", typeKey: "chase_information", outcome: "SENT", summary: "Chased two incomplete rental applications for 8 Jetty Road.", leadId: null, contactId: null, missedOpportunityId: null, createdAt: ago(60 * 5) },
  { id: "run_6", tenantId: "tenant_harbor", typeKey: "review_request", outcome: "SENT", summary: "Asked Graham Steele for a review after his appraisal.", leadId: null, contactId: "ct_4", missedOpportunityId: null, createdAt: ago(60 * 26) },
  { id: "run_7", tenantId: "tenant_summit", typeKey: "enquiry_auto_reply", outcome: "SENT", summary: "Acknowledged Jordan Lee by SMS with a trial booking link.", leadId: "lead_5", contactId: "ct_6", missedOpportunityId: null, createdAt: ago(21) },
  { id: "run_8", tenantId: "tenant_summit", typeKey: "reactivation", outcome: "SENT", summary: "Invited Chloe Baptiste back with a free class.", leadId: null, contactId: "ct_7", missedOpportunityId: "mo_4", createdAt: ago(60 * 24) },
];

export const demoExceptions: ExceptionRecord[] = [
  { id: "ex_1", tenantId: "tenant_harbor", reason: "Ana Petrova (Mount Gambier) acknowledged 9 hours ago; no booking. Two reminders sent.", suggestedAction: "Call her directly and offer an appraisal slot this week.", confidence: 0.4, status: "OPEN", assignedOperatorId: "user_ops", escalatedToUserId: null, contactId: "ct_5", leadId: "lead_4", missedOpportunityId: "mo_1", createdAt: ago(60 * 3) },
  { id: "ex_2", tenantId: "tenant_summit", reason: "Cal.com disconnected: trial bookings cannot be created.", suggestedAction: "Reconnect the Google calendar in integrations.", confidence: null, status: "OPEN", assignedOperatorId: null, escalatedToUserId: null, contactId: null, leadId: null, missedOpportunityId: null, createdAt: ago(60 * 24 * 3) },
];

// ---------------------------------------------------------------------------
// Content, posts, money
// ---------------------------------------------------------------------------

export const demoAssets: ContentAssetRecord[] = [
  { id: "asset_1", tenantId: "tenant_harbor", kind: "POST_COPY", title: "Facebook — Why Glenelg owners are switching managers", body: "Three things owners told us this month about switching managers…", targetPlatform: "FACEBOOK", status: "IN_REVIEW", needsClientSignoff: false, createdAt: ago(60 * 5) },
  { id: "asset_2", tenantId: "tenant_harbor", kind: "SHORT_FORM_SCRIPT", title: "Reel — 12 Marine Parade just leased", body: "0–3s: exterior. 3–10s: leased in 6 days at $620/week. 10–20s: what we did differently. CTA.", targetPlatform: "INSTAGRAM", status: "IN_REVIEW", needsClientSignoff: true, createdAt: ago(60 * 4) },
  { id: "asset_3", tenantId: "tenant_harbor", kind: "YOUTUBE_META", title: "Short — What an appraisal actually involves", body: "Title: What happens at a rental appraisal (90 seconds). Description: …", targetPlatform: "YOUTUBE", status: "APPROVED", needsClientSignoff: false, createdAt: ago(60 * 30) },
  { id: "asset_4", tenantId: "tenant_summit", kind: "POST_COPY", title: "Instagram — Member story: Chloe's first 5k", body: "Chloe joined in March and ran her first 5k on Saturday…", targetPlatform: "INSTAGRAM", status: "IN_REVIEW", needsClientSignoff: true, createdAt: ago(60 * 8) },
];

export const demoPosts: SocialPostRecord[] = [
  { id: "post_1", tenantId: "tenant_harbor", platform: "YOUTUBE", caption: "What happens at a rental appraisal (90 seconds)", tags: ["appraisal"], status: "SCHEDULED", scheduledFor: ahead(60 * 26), batchId: "batch_1" },
  { id: "post_2", tenantId: "tenant_summit", platform: "FACEBOOK", caption: "Spring trial week starts Monday", tags: ["trial"], status: "PUBLISHED", scheduledFor: ago(60 * 24), batchId: "batch_2" },
];

export const demoTransactions: TransactionRecord[] = [
  { id: "txn_1", tenantId: "tenant_harbor", contactId: "ct_4", leadId: null, provider: "MANUAL", providerId: "comm_01", kind: "PAYMENT", status: "COMPLETED", amountCents: 1_250_000, currency: "AUD", note: "Sales commission — 4 Harbour View", occurredAt: ago(60 * 24 * 6) },
  { id: "txn_2", tenantId: "tenant_harbor", contactId: null, leadId: null, provider: "MANUAL", providerId: "mgmt_oct", kind: "PAYMENT", status: "COMPLETED", amountCents: 1_840_000, currency: "AUD", note: "Management fees — October", occurredAt: ago(60 * 24 * 2) },
  { id: "txn_3", tenantId: "tenant_summit", contactId: "ct_6", leadId: "lead_5", provider: "SQUARE", providerId: "sq_pay_04", kind: "PAYMENT", status: "COMPLETED", amountCents: 29_000, currency: "AUD", note: "Trial week", occurredAt: ago(60) },
  { id: "txn_4", tenantId: "tenant_summit", contactId: null, leadId: null, provider: "SQUARE", providerId: "sq_pay_05", kind: "PAYMENT", status: "COMPLETED", amountCents: 1_160_000, currency: "AUD", note: "Memberships — this month", occurredAt: ago(60 * 24 * 5) },
];
