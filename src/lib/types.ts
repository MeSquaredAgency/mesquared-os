/**
 * Domain types shared by the data layer and the UI.
 *
 * They mirror the Prisma models closely but are kept independent of the
 * generated client so the app can render against in-memory fixtures before
 * a database exists. Enum string unions must match prisma/schema.prisma.
 */

// ---------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------

export type Permission = "VIEW_FINANCES" | "APPROVE_CONTENT" | "RECEIVE_LEAD_ALERTS" | "MANAGE_USERS" | "VIEW_ALL_RECORDS";
export const PERMISSIONS: Permission[] = ["VIEW_FINANCES", "APPROVE_CONTENT", "RECEIVE_LEAD_ALERTS", "MANAGE_USERS", "VIEW_ALL_RECORDS"];

export interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  isOperator: boolean;
  isPlatformAdmin: boolean;
  /** Incremented to invalidate every existing session for the user. */
  sessionVersion: number;
}

export interface TenantRoleRecord {
  id: string;
  tenantId: string;
  name: string;
  templateKey: string | null;
  permissions: Permission[];
}

/** How a user reaches a tenant: as a member with a role, as an assigned operator, or as a platform admin. */
export type AccessVia = "member" | "operator" | "admin";

/** A tenant the user may open, with what they are allowed to do in it. */
export interface TenantAccess {
  tenant: TenantSummary;
  via: AccessVia;
  roleName: string | null;
  permissions: Permission[];
}

// ---------------------------------------------------------------------------
// Tenant and configuration
// ---------------------------------------------------------------------------

export type Industry = "REAL_ESTATE" | "HEALTH_FITNESS" | "GENERIC";

export interface TenantBranding {
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  fromName?: string;
  replyTo?: string;
  /** Sign automated messages as the person assigned to the lead (their first name, replies to their email); the business otherwise. */
  signAsAssignee?: boolean;
  /** Line under every email signature (licence number, address); mirrors the brand profile's required footer. */
  footer?: string;
  /** Public contact details printed in the email signature block. */
  website?: string;
  phone?: string;
  addresses?: string[];
  social?: { facebook?: string; instagram?: string; youtube?: string; linkedin?: string };
}

/** Tenant-configured rules consumed by the qualification engine. */
export interface QualificationRules {
  greenKeywords?: string[];
  redKeywords?: string[];
  minBudget?: number;
  highIntentServices?: string[];
  /** Locations the business serves; a lead outside them is a weaker signal. */
  serviceAreas?: string[];
  /** Signals that make a lead green for this tenant, in plain language, read by the AI engine. */
  greenCriteria?: string[];
  /** Enquiry types that are handled automatically and never need the client. */
  autoHandled?: string[];
  /** A phone number is required for a lead to be green. */
  requirePhone?: boolean;
  notes?: string;
}

export interface ServiceLevels {
  /** Minutes within which a new lead must receive a first response. */
  firstResponseMinutes: number;
  /** Hours within which a green lead should have a booking, before it counts as a missed opportunity. */
  bookingWindowHours: number;
  /** Local wall-clock hours (0–23) between which automated messages are held. */
  quietHours?: { start: number; end: number };
  /**
   * What a new green lead is promised. "book_first" (the default) sends a
   * booking link and counts that reply as the first response. "call_first"
   * promises a call from the team: the automated reply does not stop the
   * response clock, only a person does, and the team is chased when the
   * window passes.
   */
  responseMode?: ResponseMode;
}

export type ResponseMode = "book_first" | "call_first";
export const RESPONSE_MODES: ResponseMode[] = ["book_first", "call_first"];

/** A workspace whose new leads are promised a call rather than a booking link. */
export const isCallFirst = (tenant: Pick<TenantSummary, "sla">): boolean => tenant.sla.responseMode === "call_first";

export type MissedOpportunityType =
  | "UNANSWERED_ENQUIRY"
  | "MISSED_CALL"
  | "ABANDONED_FORM"
  | "NOT_BOOKED"
  | "NO_SHOW"
  | "QUIET_QUOTE"
  | "UNREPLIED_DM"
  | "UNREPLIED_COMMENT"
  | "UNANSWERED_REVIEW"
  | "LAPSED_CUSTOMER";

export const MISSED_OPPORTUNITY_TYPES: MissedOpportunityType[] = [
  "UNANSWERED_ENQUIRY",
  "MISSED_CALL",
  "ABANDONED_FORM",
  "NOT_BOOKED",
  "NO_SHOW",
  "QUIET_QUOTE",
  "UNREPLIED_DM",
  "UNREPLIED_COMMENT",
  "UNANSWERED_REVIEW",
  "LAPSED_CUSTOMER",
];

/** Estimated value per missed-opportunity type, in minor units of the tenant currency. */
export type OpportunityValues = Partial<Record<MissedOpportunityType, number>>;

export interface EscalationRule {
  /** Which situation escalates, e.g. "NOT_BOOKED" or "automation:chase_documents". */
  when: string;
  /** The client user who is told, instead of (or as well as) an operator. */
  notifyUserId: string;
}

/** Where a client's onboarding questionnaire is: sent, being filled in, handed back, turned into a workspace, or withdrawn. */
export type OnboardingStatus = "INVITED" | "IN_PROGRESS" | "SUBMITTED" | "PROVISIONED" | "CANCELLED";

/**
 * A client onboarding questionnaire, sent before the client's workspace
 * exists, so it is platform-level rather than tenant data. The client opens it
 * with a private link whose token is stored only as a hash (never on the
 * record). `answers` are the client's own words: validated against the form,
 * never logged.
 */
export interface OnboardingRecord {
  id: string;
  /** What the operator called it, usually the business name. */
  label: string;
  contactEmail: string | null;
  status: OnboardingStatus;
  answers: Record<string, unknown>;
  createdById: string | null;
  /** The workspace made from it, once provisioned. */
  tenantId: string | null;
  startedAt: Date | null;
  submittedAt: Date | null;
  provisionedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantSummary {
  id: string;
  slug: string;
  name: string;
  industry: Industry;
  templateKey: string | null;
  region: string;
  timezone: string;
  /** BCP 47 tag for date and number formatting, e.g. "en-AU". */
  locale: string;
  currency: string;
  branding: TenantBranding;
  qualificationRules: QualificationRules;
  sla: ServiceLevels;
  escalationRules: EscalationRule[];
  opportunityValues: OpportunityValues;
}

/** The minimum a client component needs to render a workspace picker. Never ship rules or settings to the browser. */
export interface TenantOption {
  id: string;
  slug: string;
  name: string;
  primaryColor: string | null;
}

export function toTenantOption(t: TenantSummary): TenantOption {
  return { id: t.id, slug: t.slug, name: t.name, primaryColor: t.branding.primaryColor ?? null };
}

export interface TenantModuleRecord {
  moduleKey: string;
  enabled: boolean;
  settings: Record<string, unknown>;
}

export type IntegrationProvider =
  | "CALCOM"
  | "GOOGLE_CALENDAR"
  | "OUTLOOK_CALENDAR"
  | "META"
  | "GOOGLE_ADS"
  | "GOOGLE_LEAD_FORMS"
  | "TIKTOK"
  | "YOUTUBE"
  | "LINKEDIN"
  | "GOOGLE_BUSINESS"
  | "SQUARE"
  | "STRIPE"
  | "XERO"
  | "QUICKBOOKS"
  | "TWILIO"
  | "RESEND"
  | "WHATSAPP"
  | "REA"
  | "DOMAIN"
  | "PROPERTY_MANAGEMENT"
  | "EMAIL_FORWARDING"
  | "CALL_TRACKING"
  | "WEBSITE"
  | "OTHER";

export type IntegrationStatus = "PENDING" | "CONNECTED" | "NEEDS_ATTENTION" | "DISCONNECTED";

export interface IntegrationRecord {
  id: string;
  tenantId: string;
  provider: IntegrationProvider;
  label: string | null;
  status: IntegrationStatus;
  externalAccountId: string | null;
  lastSyncAt: Date | null;
  lastError: string | null;
}

export interface BrandProfileRecord {
  voice: string | null;
  examples: string[];
  bannedPhrases: string[];
  complianceBlock: ComplianceBlock;
}

export interface ComplianceBlock {
  requiredFooter?: string;
  prohibitedCombinations?: string[];
  claimsPolicy?: string;
  mustNot?: string[];
}

// ---------------------------------------------------------------------------
// Contacts, pipelines, leads
// ---------------------------------------------------------------------------

export interface ConsentEntry {
  granted: boolean;
  at?: string;
  source?: string;
}

export interface ContactRecord {
  id: string;
  tenantId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  /** Per-channel marketing consent: { sms, email, whatsapp }. Transactional replies never need it. */
  consent: Partial<Record<"sms" | "email" | "whatsapp", ConsentEntry>>;
  tags: string[];
  lastActivityAt: Date | null;
  lapsedAt: Date | null;
  createdAt: Date;
}

export type StageAdvanceTrigger = "MANUAL" | "BOOKING_CREATED" | "BOOKING_COMPLETED" | "PAYMENT_RECEIVED" | "DOCUMENT_SIGNED";

export interface PipelineStageRecord {
  id: string;
  pipelineId: string;
  key: string;
  name: string;
  order: number;
  advanceOn: StageAdvanceTrigger;
  isWon: boolean;
  isLost: boolean;
  /** Days of silence in this stage before a lead counts as a quote gone quiet. */
  quietAfterDays: number | null;
}

export interface PipelineRecord {
  id: string;
  tenantId: string;
  key: string;
  name: string;
  isDefault: boolean;
  stages: PipelineStageRecord[];
}

export type TicketType = "GREEN" | "RED";

export type LeadSource =
  | "WEB_FORM"
  | "LANDING_PAGE"
  | "META_LEAD_FORM"
  | "GOOGLE_LEAD_FORM"
  | "TIKTOK_LEAD_FORM"
  | "LINKEDIN_LEAD_FORM"
  | "SOCIAL_DM"
  | "SOCIAL_COMMENT"
  | "PORTAL_EMAIL"
  | "YOUTUBE"
  | "REFERRAL"
  | "PHONE"
  | "EMAIL"
  | "MANUAL"
  | "OTHER";

export type LeadStatus = "NEW" | "QUALIFIED" | "BOOKING_SENT" | "BOOKED" | "NURTURING" | "WON" | "LOST" | "ARCHIVED";

export interface LeadRecord {
  id: string;
  tenantId: string;
  contactId: string | null;
  pipelineId: string | null;
  stageId: string | null;
  assigneeId: string | null;
  source: LeadSource;
  externalId: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  message: string | null;
  attributes: Record<string, unknown>;
  attribution: Record<string, unknown>;
  status: LeadStatus;
  ticketType: TicketType | null;
  intentScore: number | null;
  qualificationReason: string | null;
  qualifiedBy: string | null;
  valueCents: number;
  respondBy: Date | null;
  bookBy: Date | null;
  firstResponseAt: Date | null;
  bookedAt: Date | null;
  stageEnteredAt: Date | null;
  lastActivityAt: Date | null;
  createdAt: Date;
}

export type BookingStatus = "LINK_PENDING" | "LINK_SENT" | "SCHEDULED" | "COMPLETED" | "NO_SHOW" | "CANCELLED";

export interface BookingRecord {
  id: string;
  tenantId: string;
  leadId: string;
  provider: "CALCOM" | "GOOGLE_CALENDAR" | "MANUAL";
  externalId: string | null;
  bookingUrl: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  status: BookingStatus;
  confirmedAt: Date | null;
  remindedAt: Date | null;
  followedUpAt: Date | null;
  createdAt: Date;
}

export type MessageChannel = "SMS" | "EMAIL" | "WHATSAPP" | "SOCIAL_DM" | "SOCIAL_COMMENT" | "PHONE";

export interface ConversationRecord {
  id: string;
  tenantId: string;
  contactId: string | null;
  channel: MessageChannel;
  externalId: string | null;
  lastMessageAt: Date | null;
  awaitingReply: boolean;
  /** Social inbox threads: which platform/channel they came from and the provider ids needed to reply. */
  platform?: SocialPlatform | null;
  channelId?: string | null;
  /** Provider-specific thread references (comment id, post id, sender id, page id). */
  meta?: Record<string, unknown>;
  /** Name the platform showed for the other party (comments and DMs have no contact record). */
  displayName?: string | null;
  /** A reply drafted by the triage automation for a person to send with one click. */
  suggestedReply?: string | null;
}

export interface MessageRecord {
  id: string;
  tenantId: string;
  conversationId: string;
  direction: "INBOUND" | "OUTBOUND";
  sender: "CONTACT" | "AUTOMATION" | "OPERATOR" | "CLIENT_STAFF";
  body: string;
  status: string;
  providerMessageId: string | null;
  createdAt: Date;
}

export type ScheduledActionStatus = "PENDING" | "RUNNING" | "DONE" | "CANCELLED" | "FAILED";

export interface ScheduledActionRecord {
  id: string;
  tenantId: string;
  typeKey: string;
  action: string;
  runAt: Date;
  payload: Record<string, unknown>;
  dedupeKey: string;
  status: ScheduledActionStatus;
  attempts: number;
}

export type InformationRequestStatus = "OPEN" | "RECEIVED" | "CANCELLED" | "ESCALATED";

export interface InformationRequestRecord {
  id: string;
  tenantId: string;
  contactId: string | null;
  leadId: string | null;
  kind: string;
  description: string;
  dueAt: Date | null;
  status: InformationRequestStatus;
  chaseCount: number;
  lastChasedAt: Date | null;
  receivedAt: Date | null;
  createdAt: Date;
}

export interface ReviewRecord {
  id: string;
  tenantId: string;
  provider: string;
  externalId: string;
  authorName: string | null;
  rating: number | null;
  body: string | null;
  url: string | null;
  receivedAt: Date;
  repliedAt: Date | null;
}

export interface FormSessionRecord {
  id: string;
  tenantId: string;
  sessionKey: string;
  formName: string | null;
  pageUrl: string | null;
  partial: Record<string, unknown>;
  startedAt: Date;
  lastSeenAt: Date;
  submittedAt: Date | null;
  convertedLeadId: string | null;
  flaggedAt: Date | null;
}

// ---------------------------------------------------------------------------
// Missed opportunities, automation, exceptions, events
// ---------------------------------------------------------------------------

export type MissedOpportunityStatus = "DETECTED" | "RECOVERING" | "RECOVERED" | "ESCALATED" | "EXPIRED";

export interface MissedOpportunityRecord {
  id: string;
  tenantId: string;
  type: MissedOpportunityType;
  status: MissedOpportunityStatus;
  /** `${type}:${subjectId}`; the subject is a lead, contact, review, booking or conversation id. */
  dedupeKey: string;
  contactId: string | null;
  leadId: string | null;
  estimatedValueCents: number;
  recoveredValueCents: number;
  summary: string;
  detectedAt: Date;
  resolvedAt: Date | null;
}

export type AutomationOutcome = "SENT" | "COMPLETED" | "SKIPPED" | "ESCALATED" | "FAILED";

export interface AutomationRunRecord {
  id: string;
  tenantId: string;
  typeKey: string;
  outcome: AutomationOutcome;
  summary: string;
  leadId: string | null;
  contactId: string | null;
  missedOpportunityId: string | null;
  createdAt: Date;
}

export interface TenantAutomationRecord {
  typeKey: string;
  enabled: boolean;
  settings: Record<string, unknown>;
}

export type ExceptionStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED";

export interface ExceptionRecord {
  id: string;
  tenantId: string;
  reason: string;
  suggestedAction: string | null;
  confidence: number | null;
  status: ExceptionStatus;
  assignedOperatorId: string | null;
  escalatedToUserId: string | null;
  contactId: string | null;
  leadId: string | null;
  missedOpportunityId: string | null;
  createdAt: Date;
}

export interface DomainEventRecord {
  id: string;
  tenantId: string;
  type: string;
  payload: Record<string, unknown>;
  causationId: string | null;
  occurredAt: Date;
}

// ---------------------------------------------------------------------------
// Content, social, finance
// ---------------------------------------------------------------------------

export type SocialPlatform = "FACEBOOK" | "INSTAGRAM" | "TIKTOK" | "YOUTUBE" | "LINKEDIN" | "GOOGLE_BUSINESS";
export const SOCIAL_PLATFORMS: SocialPlatform[] = ["FACEBOOK", "INSTAGRAM", "TIKTOK", "YOUTUBE", "LINKEDIN", "GOOGLE_BUSINESS"];

export type ContentStatus = "DRAFT" | "IN_REVIEW" | "APPROVED" | "REJECTED" | "SCHEDULED" | "PUBLISHED";
export type PostStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "SCHEDULED" | "PUBLISHING" | "PUBLISHED" | "FAILED";

export type ContentAssetKind = "RAW_TEXT" | "RAW_AUDIO" | "RAW_VIDEO" | "TRANSCRIPT" | "HOOK" | "QUOTE" | "POST_COPY" | "CAROUSEL" | "YOUTUBE_META" | "SHORT_FORM_SCRIPT" | "IMAGE" | "WEB_PAGE" | "BLOG_POST" | "AD_COPY" | "EMAIL";
/** Source material the engine works from, as opposed to what it produces. */
export const SOURCE_KINDS: ContentAssetKind[] = ["RAW_TEXT", "RAW_AUDIO", "RAW_VIDEO", "IMAGE", "TRANSCRIPT"];

export interface ComplianceIssue {
  code: "BANNED_PHRASE" | "HYPE" | "PRICE" | "NAMED_PERSON" | "CLAIM" | "STALE_NUMBER" | "COMBINED_SUBJECTS" | "TOO_LONG" | "MISSING_FOOTER";
  message: string;
  /** block: must be fixed before approval; signoff: the client decides; note: shown, not enforced. */
  severity: "block" | "signoff" | "note";
}

export interface ComplianceReport {
  ok: boolean;
  needsClientSignoff: boolean;
  issues: ComplianceIssue[];
  checkedAt: string;
}

/** What the engine recorded about how an asset came to be. */
export interface AssetGeneration {
  engine?: string;
  model?: string | null;
  hashtags?: string[];
  mediaBrief?: string | null;
  claims?: string[];
  compliance?: ComplianceReport;
  /** The origin of a source asset: "upload", "review", "api", "operator". */
  origin?: string;
  sourceRef?: string | null;
}

export interface ContentAssetRecord {
  id: string;
  tenantId: string;
  parentId: string | null;
  kind: ContentAssetKind | string;
  title: string | null;
  body: string | null;
  targetPlatform: SocialPlatform | null;
  status: ContentStatus;
  needsClientSignoff: boolean;
  /** `neon-storage://assets/<key>` for files held on Neon Object Storage, an external URL, or absent. */
  fileUrl?: string | null;
  tags: string[];
  scheduledFor: Date | null;
  generation: AssetGeneration;
  rejectionNote: string | null;
  approvedAt: Date | null;
  createdAt: Date;
}

export interface ChannelRecord {
  id: string;
  tenantId: string;
  integrationId: string | null;
  platform: SocialPlatform;
  /** Page id, IG business account id, GBP location name, LinkedIn organisation URN, YouTube channel id, TikTok open id. */
  externalAccountId: string;
  displayName: string | null;
  isActive: boolean;
  settings: Record<string, unknown>;
}

export interface SocialPostRecord {
  id: string;
  tenantId: string;
  channelId: string | null;
  contentAssetId: string | null;
  platform: SocialPlatform;
  caption: string;
  mediaUrls: string[];
  tags: string[];
  status: PostStatus;
  scheduledFor: Date | null;
  publishedAt: Date | null;
  externalPostId: string | null;
  permalink: string | null;
  errorMessage: string | null;
  attempts: number;
  metrics: Record<string, number>;
  batchId: string | null;
  createdAt: Date;
}

export interface ChannelMetricSnapshotRecord {
  id: string;
  tenantId: string;
  channelId: string;
  platform: SocialPlatform;
  /** UTC midnight of the day the numbers describe. */
  date: Date;
  followers: number | null;
  reach: number | null;
  impressions: number | null;
  engagements: number | null;
  clicks: number | null;
  posts: number | null;
}

export type FinanceProvider = "SQUARE" | "STRIPE" | "XERO" | "QUICKBOOKS" | "MANUAL";
/** Providers that can actually be connected (MANUAL is the ledger's own entries). */
export type ConnectedFinanceProvider = Exclude<FinanceProvider, "MANUAL">;
export type TransactionKind = "CONSULTATION_FEE" | "RETAINER_DEPOSIT" | "PAYMENT" | "INVOICE" | "REFUND" | "EXPENSE" | "OTHER";
export type TransactionStatus = "PENDING" | "COMPLETED" | "FAILED" | "REFUNDED" | "OVERDUE";

export interface TransactionRecord {
  id: string;
  tenantId: string;
  contactId: string | null;
  leadId: string | null;
  provider: FinanceProvider;
  providerId: string;
  kind: TransactionKind;
  status: TransactionStatus;
  amountCents: number;
  currency: string;
  note: string | null;
  occurredAt: Date;
}

// ---------------------------------------------------------------------------
// Read models for the two surfaces
// ---------------------------------------------------------------------------

export interface MoneySummary {
  revenueMonthCents: number;
  adSpendMonthCents: number;
  leadsMonth: number;
  /** Null when there is no spend or no leads to divide by. */
  costPerLeadCents: number | null;
  currency: string;
  /** Invoices sent and not yet paid, and the overdue part of that. */
  outstandingCents?: number;
  overdueCents?: number;
  overdueCount?: number;
  /** Revenue minus expenses minus ad spend, this month. */
  profitMonthCents?: number;
  expensesMonthCents?: number;
}

// ---------------------------------------------------------------------------
// Ads, attribution, finance, website (Phase 4)
// ---------------------------------------------------------------------------

export type AdPlatform = "META" | "GOOGLE_ADS";

export interface AdAccountRecord {
  id: string;
  tenantId: string;
  platform: AdPlatform;
  /** Meta: "act_123"; Google Ads: the customer id "123-456-7890" (digits only when stored). */
  externalAccountId: string;
  name: string | null;
  currency: string;
  /** The tenant's planned spend per calendar month, for pacing. */
  monthlyBudgetCents: number | null;
  isActive: boolean;
  lastSyncAt: Date | null;
  lastError: string | null;
  settings: Record<string, unknown>;
}

export interface AdSpendSnapshotRecord {
  id: string;
  tenantId: string;
  adAccountId: string;
  platform: AdPlatform;
  /** UTC midnight of the day described. */
  date: Date;
  campaignId: string | null;
  campaignName: string | null;
  spendCents: number;
  impressions: number | null;
  clicks: number | null;
  /** Leads the platform itself reports (lead-form submissions, conversions). */
  platformLeads: number | null;
}

export type InvoiceStatus = "DRAFT" | "SENT" | "PAID" | "OVERDUE" | "VOID";

export interface InvoiceRecord {
  id: string;
  tenantId: string;
  contactId: string | null;
  provider: FinanceProvider;
  externalId: string;
  number: string | null;
  amountCents: number;
  amountDueCents: number;
  currency: string;
  status: InvoiceStatus;
  issuedAt: Date | null;
  dueAt: Date | null;
  paidAt: Date | null;
  url: string | null;
  customerName: string | null;
  customerEmail: string | null;
  remindersSent: number;
  lastReminderAt: Date | null;
}

export interface TrackedLinkRecord {
  id: string;
  tenantId: string;
  /** Short code in /r/<code>. */
  code: string;
  destination: string;
  label: string | null;
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  clicks: number;
  createdAt: Date;
}

export type WebEventKind = "PAGEVIEW" | "FORM_START" | "FORM_SUBMIT" | "LINK_CLICK";

export interface WebEventRecord {
  id: string;
  tenantId: string;
  kind: WebEventKind;
  path: string | null;
  referrer: string | null;
  source: string | null;
  sessionKey: string | null;
  occurredAt: Date;
}

export interface SiteMetricSnapshotRecord {
  id: string;
  tenantId: string;
  /** UTC midnight of the day described. */
  date: Date;
  sessions: number;
  pageviews: number;
  formStarts: number;
  formSubmits: number;
  linkClicks: number;
  /** Path → pageviews, top ten. */
  topPages: Record<string, number>;
  /** utm_source or referrer host → sessions, top ten. */
  topSources: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Provisioning, people, keys, inventory (Phase 5)
// ---------------------------------------------------------------------------

export interface TenantPersonRecord {
  userId: string;
  email: string;
  name: string | null;
  via: "member" | "operator";
  roleId: string | null;
  roleName: string | null;
  permissions: Permission[];
  /** Signature details for messages signed by this person (members only). */
  title: string | null;
  phone: string | null;
  photoUrl: string | null;
}

export interface ApiKeyRecord {
  id: string;
  tenantId: string;
  label: string;
  keyPrefix: string;
  scopes: ("intake" | "content" | "webhooks")[];
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export type InventoryType = "LISTING" | "CAPACITY" | "STOCK";
export type InventoryStatus = "ACTIVE" | "LOW" | "UNAVAILABLE" | "ARCHIVED";

export interface InventoryItemRecord {
  id: string;
  tenantId: string;
  type: InventoryType;
  externalId: string | null;
  name: string;
  status: InventoryStatus;
  quantity: number | null;
  valueCents: number | null;
  /** Listing: { address, suburb, rentPerWeekCents, priceCents, bedrooms, bathrooms, url, availableFrom }. */
  attributes: Record<string, unknown>;
  source: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** One line of the launch checklist for a workspace. */
export interface ReadinessCheck {
  key: string;
  label: string;
  /** required: must pass before launch; recommended: should pass; optional: nice to have. */
  level: "required" | "recommended" | "optional";
  ok: boolean;
  detail: string;
}

/** One row of the attribution report: a channel (source/campaign) with what it cost and what it brought. */
export interface AttributionRow {
  key: string;
  source: string;
  campaign: string | null;
  spendCents: number;
  leads: number;
  booked: number;
  won: number;
  revenueCents: number;
  costPerLeadCents: number | null;
  costPerAcquisitionCents: number | null;
  /** Revenue per dollar of spend, or null without spend. */
  roas: number | null;
}

/** What the client portal home renders. */
export interface PortalHome {
  needsYou: LeadRecord[];
  missed: { open: MissedOpportunityRecord[]; atRiskCents: number; recoveredCents: number };
  money: MoneySummary | null;
  contentAwaiting: ContentAssetRecord[];
  /** Only runs that count as handled (see src/lib/portal/handled.ts); `byType` covers the last seven days. */
  handled: { runs: AutomationRunRecord[]; countToday: number; countWeek: number; byType: { typeKey: string; count: number }[] };
}

export type IntegrationHealth = { provider: IntegrationProvider; status: IntegrationStatus; lastError: string | null };

/** One row of the operator portfolio. */
export interface PortfolioRow {
  tenant: TenantSummary;
  /** 0–100; see src/lib/health.ts */
  health: number;
  slaBreaches: number;
  missedOpen: number;
  missedAtRiskCents: number;
  exceptionsOpen: number;
  contentDue: number;
  /** Spend this month as a share of budget, or null when ads are not connected. */
  adPacing: { spentCents: number; budgetCents: number; daysElapsed: number; daysInMonth: number } | null;
  integrations: IntegrationHealth[];
  leadsToday: number;
}
