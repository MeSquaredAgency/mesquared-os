import type {
  AdAccountRecord,
  AdPlatform,
  AdSpendSnapshotRecord,
  ApiKeyRecord,
  AssetGeneration,
  AutomationOutcome,
  AutomationRunRecord,
  BookingRecord,
  BookingStatus,
  BrandProfileRecord,
  ChannelMetricSnapshotRecord,
  ChannelRecord,
  ContactRecord,
  ContentAssetRecord,
  ContentStatus,
  ConversationRecord,
  DomainEventRecord,
  EscalationRule,
  ExceptionRecord,
  ExceptionStatus,
  FinanceProvider,
  FormSessionRecord,
  Industry,
  InformationRequestRecord,
  InformationRequestStatus,
  IntegrationRecord,
  InventoryItemRecord,
  InventoryStatus,
  InventoryType,
  InvoiceRecord,
  InvoiceStatus,
  LeadRecord,
  LeadSource,
  MessageRecord,
  MissedOpportunityRecord,
  MissedOpportunityStatus,
  MissedOpportunityType,
  OpportunityValues,
  PipelineRecord,
  PortalHome,
  PortfolioRow,
  PostStatus,
  QualificationRules,
  ReviewRecord,
  ScheduledActionRecord,
  ScheduledActionStatus,
  ServiceLevels,
  SiteMetricSnapshotRecord,
  SocialPlatform,
  SocialPostRecord,
  TenantAccess,
  TenantAutomationRecord,
  TenantBranding,
  TenantModuleRecord,
  TenantPersonRecord,
  TenantRoleRecord,
  TenantSummary,
  TicketType,
  TrackedLinkRecord,
  TransactionKind,
  TransactionRecord,
  TransactionStatus,
  OnboardingRecord,
  OnboardingStatus,
  UserRecord,
  WebEventKind,
  WebEventRecord,
} from "@/lib/types";
import type { IndustryTemplate } from "@/lib/templates/types";

export type IntakeChannel = "WEB_FORM" | "META_LEAD_FORM" | "GOOGLE_LEAD_FORM" | "SOCIAL_DM" | "SOCIAL_COMMENT" | "EMAIL_FORWARD" | "CALL" | "VOICEMAIL" | "PORTAL_EMAIL" | "API";
export type IntakeOutcome = "CREATED" | "DUPLICATE" | "REJECTED";

export interface ContactInput {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
}

export interface NewLead extends ContactInput {
  contactId: string | null;
  source: LeadSource;
  externalId: string | null;
  message: string | null;
  attributes: Record<string, unknown>;
  attribution: Record<string, unknown>;
  ticketType: TicketType;
  intentScore: number;
  qualificationReason: string;
  qualifiedBy: string;
  /** Resolved from the tenant's default pipeline; null when the lead is RED. */
  pipelineId: string | null;
  stageId: string | null;
  valueCents: number;
  respondBy: Date | null;
  bookBy: Date | null;
}

export interface NewBooking {
  leadId: string;
  bookingUrl: string;
  /** True once the messaging adapter has delivered the link to the lead. */
  sent: boolean;
}

export interface IntakeEventInput {
  channel: IntakeChannel;
  provider: string | null;
  externalId: string | null;
  contactId: string | null;
  leadId: string | null;
  outcome: IntakeOutcome;
  /** Redacted raw request body. */
  payload: Record<string, unknown>;
  classifier: string | null;
}

export interface NewMissedOpportunity {
  type: MissedOpportunityType;
  contactId: string | null;
  leadId: string | null;
  estimatedValueCents: number;
  summary: string;
  /** One open item per (subject, type); callers build it as `${type}:${leadId|contactId}`. */
  dedupeKey: string;
}

export interface NewAutomationRun {
  typeKey: string;
  outcome: AutomationOutcome;
  summary: string;
  details?: Record<string, unknown>;
  contactId?: string | null;
  leadId?: string | null;
  missedOpportunityId?: string | null;
}

export interface NewException {
  reason: string;
  suggestedAction?: string | null;
  confidence?: number | null;
  contactId?: string | null;
  leadId?: string | null;
  missedOpportunityId?: string | null;
  escalatedToUserId?: string | null;
}

export interface NewContentAsset {
  kind: string;
  title: string | null;
  body: string | null;
  targetPlatform: SocialPlatform | null;
  status: ContentStatus;
  needsClientSignoff: boolean;
  tags: string[];
  scheduledFor: Date | null;
  /** The source asset this was generated from. */
  parentId?: string | null;
  generation?: AssetGeneration;
  /** `neon-storage://assets/<key>` for files we hold (see src/lib/storage.ts), or an external link. */
  fileUrl?: string | null;
}

export type MessageChannel = "SMS" | "EMAIL" | "WHATSAPP" | "SOCIAL_DM" | "SOCIAL_COMMENT" | "PHONE";

export interface NewMessage {
  contactId: string | null;
  /** Destination address or number for outbound messages (used for per-recipient caps). */
  to?: string | null;
  channel: MessageChannel;
  direction: "INBOUND" | "OUTBOUND";
  sender: "CONTACT" | "AUTOMATION" | "OPERATOR" | "CLIENT_STAFF";
  body: string;
  status: "QUEUED" | "SENT" | "DELIVERED" | "FAILED" | "RECEIVED";
  subject?: string | null;
  providerMessageId?: string | null;
  automationRunId?: string | null;
  /** Thread id from the provider (email thread, DM thread) when known. */
  externalConversationId?: string | null;
}

export interface AlertRecipient {
  userId: string;
  email: string;
  name: string | null;
}

export interface IntegrationSettings {
  id: string;
  provider: import("@/lib/types").IntegrationProvider;
  status: import("@/lib/types").IntegrationStatus;
  externalAccountId: string | null;
  settings: Record<string, unknown>;
  /** Decrypted by the caller with decryptSecret when present. */
  credentialsEnc: string | null;
}

export interface NewScheduledAction {
  typeKey: string;
  action: string;
  runAt: Date;
  payload?: Record<string, unknown>;
  dedupeKey: string;
}

export interface NewInformationRequest {
  contactId: string | null;
  leadId: string | null;
  kind: string;
  description: string;
  dueAt: Date | null;
}

export interface NewReview {
  provider: string;
  externalId: string;
  authorName: string | null;
  rating: number | null;
  body: string | null;
  url: string | null;
  receivedAt: Date;
}

/** intake: public web forms and the page beacon. webhooks: call-tracking and review connectors (private). content: uploads and the library (private). */
export type ApiKeyScope = "intake" | "content" | "webhooks";

// --- Phase 4 inputs ---------------------------------------------------------------

export interface NewAdAccount {
  platform: AdPlatform;
  externalAccountId: string;
  name?: string | null;
  currency?: string;
  monthlyBudgetCents?: number | null;
  isActive?: boolean;
  settings?: Record<string, unknown>;
}

export interface AdAccountPatch {
  name?: string | null;
  currency?: string;
  monthlyBudgetCents?: number | null;
  isActive?: boolean;
  lastSyncAt?: Date | null;
  lastError?: string | null;
}

export interface NewAdSpend {
  adAccountId: string;
  platform: AdPlatform;
  date: Date;
  campaignId: string | null;
  campaignName: string | null;
  spendCents: number;
  impressions?: number | null;
  clicks?: number | null;
  platformLeads?: number | null;
  raw?: Record<string, unknown>;
}

export interface NewTransaction {
  provider: FinanceProvider;
  providerId: string;
  kind: TransactionKind;
  status: TransactionStatus;
  amountCents: number;
  currency: string;
  occurredAt: Date;
  note?: string | null;
  contactId?: string | null;
  leadId?: string | null;
  /** Used to link the row to a contact by email when the provider gives one. */
  customerEmail?: string | null;
  rawPayload?: Record<string, unknown>;
}

export interface NewInvoice {
  provider: FinanceProvider;
  externalId: string;
  number?: string | null;
  amountCents: number;
  amountDueCents: number;
  currency: string;
  status: InvoiceStatus;
  issuedAt?: Date | null;
  dueAt?: Date | null;
  paidAt?: Date | null;
  url?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  contactId?: string | null;
  rawPayload?: Record<string, unknown>;
}

export interface NewTrackedLink {
  code: string;
  destination: string;
  label?: string | null;
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  content?: string | null;
}

export interface NewWebEvent {
  kind: WebEventKind;
  path?: string | null;
  referrer?: string | null;
  source?: string | null;
  sessionKey?: string | null;
  occurredAt?: Date;
}

export interface NewSiteMetrics {
  date: Date;
  sessions: number;
  pageviews: number;
  formStarts: number;
  formSubmits: number;
  linkClicks: number;
  topPages: Record<string, number>;
  topSources: Record<string, number>;
}

export interface NewTenant {
  slug: string;
  name: string;
  industry: Industry;
  templateKey: string | null;
  region: string;
  timezone: string;
  locale: string;
  currency: string;
  branding?: TenantBranding;
  qualificationRules?: QualificationRules;
  sla?: ServiceLevels;
  opportunityValues?: OpportunityValues;
  settings?: Record<string, unknown>;
}

export interface TenantPatch {
  name?: string;
  region?: string;
  timezone?: string;
  locale?: string;
  currency?: string;
  branding?: TenantBranding;
  qualificationRules?: QualificationRules;
  sla?: ServiceLevels;
  escalationRules?: EscalationRule[];
  opportunityValues?: OpportunityValues;
  settings?: Record<string, unknown>;
  isActive?: boolean;
}

export interface NewUser {
  email: string;
  name: string | null;
  passwordHash: string | null;
  isOperator?: boolean;
  isPlatformAdmin?: boolean;
}

export interface NewApiKey {
  label: string;
  keyHash: string;
  keyPrefix: string;
  scopes: ApiKeyScope[];
}

export interface NewInventoryItem {
  type: InventoryType;
  externalId?: string | null;
  name: string;
  status?: InventoryStatus;
  quantity?: number | null;
  valueCents?: number | null;
  attributes?: Record<string, unknown>;
  source?: string | null;
}

/** Signature details kept on a membership; undefined leaves a field as it is, null clears it. */
export interface MemberProfile {
  title?: string | null;
  phone?: string | null;
  photoUrl?: string | null;
}

export interface IntegrationUpsert {
  provider: import("@/lib/types").IntegrationProvider;
  externalAccountId: string;
  label?: string | null;
  status?: import("@/lib/types").IntegrationStatus;
  credentialsEnc?: string | null;
  settings?: Record<string, unknown>;
  lastError?: string | null;
  lastSyncAt?: Date | null;
}

export interface ContentAssetPatch {
  title?: string | null;
  body?: string | null;
  tags?: string[];
  scheduledFor?: Date | null;
  status?: ContentStatus;
  needsClientSignoff?: boolean;
  generation?: AssetGeneration;
  rejectionNote?: string | null;
  targetPlatform?: SocialPlatform | null;
}

export interface NewChannel {
  platform: SocialPlatform;
  externalAccountId: string;
  displayName?: string | null;
  integrationId?: string | null;
  isActive?: boolean;
  settings?: Record<string, unknown>;
}

export interface NewSocialPost {
  channelId: string | null;
  contentAssetId: string | null;
  platform: SocialPlatform;
  caption: string;
  mediaUrls?: string[];
  tags?: string[];
  status: PostStatus;
  scheduledFor: Date | null;
  batchId?: string | null;
}

export interface SocialPostPatch {
  status?: PostStatus;
  scheduledFor?: Date | null;
  publishedAt?: Date | null;
  externalPostId?: string | null;
  permalink?: string | null;
  errorMessage?: string | null;
  attempts?: number;
  caption?: string;
  mediaUrls?: string[];
  channelId?: string | null;
  metrics?: Record<string, number>;
}

export interface NewChannelMetrics {
  channelId: string;
  platform: SocialPlatform;
  date: Date;
  followers?: number | null;
  reach?: number | null;
  impressions?: number | null;
  engagements?: number | null;
  clicks?: number | null;
  posts?: number | null;
  raw?: Record<string, unknown>;
}

export interface NewSocialConversation {
  channelId: string | null;
  platform: SocialPlatform;
  channel: "SOCIAL_DM" | "SOCIAL_COMMENT";
  /** Provider thread id: the post for comments, the conversation for DMs. */
  externalId: string;
  displayName: string | null;
  meta?: Record<string, unknown>;
  contactId?: string | null;
}

export interface BookingPatch {
  status?: BookingStatus;
  startsAt?: Date | null;
  endsAt?: Date | null;
  externalId?: string | null;
  confirmedAt?: Date | null;
  remindedAt?: Date;
  followedUpAt?: Date;
}

export interface TenantConfig {
  modules: TenantModuleRecord[];
  automations: TenantAutomationRecord[];
  integrations: IntegrationRecord[];
  pipelines: PipelineRecord[];
  roles: TenantRoleRecord[];
  brand: BrandProfileRecord | null;
}

export interface PortalHomeOptions {
  timezone: string;
  currency: string;
  /** Limit "Needs you" to this user's own leads when they lack VIEW_ALL_RECORDS. */
  onlyAssigneeId: string | null;
  canViewFinances: boolean;
}

export interface Workbench {
  /** Everything the engine produced, newest first (sources excluded). */
  assets: ContentAssetRecord[];
  /** Raw material and transcripts, newest first. */
  sources: ContentAssetRecord[];
  posts: SocialPostRecord[];
  channels: ChannelRecord[];
  connectedPlatforms: SocialPlatform[];
}

/** Thrown when a write references a row (e.g. a lead) outside the tenant. */
export class TenantMismatchError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} ${id} does not belong to this tenant.`);
    this.name = "TenantMismatchError";
  }
}

/**
 * Every query is tenant-scoped by construction: callers pass the tenantId
 * and implementations must never read or write rows of another tenant.
 * Writes that reference other rows (leadId…) verify those rows belong to
 * the same tenant and throw TenantMismatchError otherwise.
 */
export interface Repository {
  // --- users and access -----------------------------------------------------
  findUserById(id: string): Promise<UserRecord | null>;
  findUserByEmail(email: string): Promise<{ user: UserRecord; passwordHash: string | null } | null>;
  /** Operator and platform-admin flags; the only way they change after creation. */
  setUserFlags(userId: string, flags: { isOperator?: boolean; isPlatformAdmin?: boolean }): Promise<void>;
  /** Every tenant the user can open: memberships (with role), operator assignments, or all for platform admins. */
  listTenantAccess(userId: string): Promise<TenantAccess[]>;
  findTenantBySlug(slug: string): Promise<TenantSummary | null>;
  findTenantById(tenantId: string): Promise<TenantSummary | null>;
  /** Every active tenant; used by scheduled jobs, never by request handlers. */
  listAllTenants(): Promise<TenantSummary[]>;
  findTenantByApiKeyHash(hash: string): Promise<{ tenant: TenantSummary; apiKeyId: string | null; scopes: ApiKeyScope[] } | null>;

  // --- configuration -----------------------------------------------------------
  getTenantConfig(tenantId: string): Promise<TenantConfig>;

  // --- contacts, leads, bookings --------------------------------------------------
  /** Finds a contact by email or phone within the tenant, else creates one. */
  upsertContact(tenantId: string, data: ContactInput): Promise<ContactRecord>;
  findDuplicateLead(tenantId: string, probe: { externalId: string | null; email: string | null; phone: string | null }): Promise<LeadRecord | null>;
  /** Inserts the lead. When another request inserted the same externalId first (race), returns that row with `created: false`. */
  createLead(tenantId: string, data: NewLead): Promise<{ lead: LeadRecord; created: boolean }>;
  listRecentLeads(tenantId: string, limit?: number): Promise<LeadRecord[]>;
  /** Green leads still waiting on a person, newest and hottest first. */
  listNeedsYou(tenantId: string, opts: { onlyAssigneeId: string | null; limit: number }): Promise<LeadRecord[]>;
  /** Leads whose response or booking deadline has passed without the matching event. */
  listLeadsPastSla(tenantId: string, now: Date): Promise<{ respond: LeadRecord[]; book: LeadRecord[] }>;
  /** The same two breaches counted, for the portfolio. */
  countLeadsPastSla(tenantId: string, now: Date): Promise<number>;
  findLeadById(tenantId: string, leadId: string): Promise<LeadRecord | null>;
  markLeadResponded(tenantId: string, leadId: string, at: Date): Promise<void>;
  /** Records the booking time and moves the lead into the first stage whose `advanceOn` matches, if any. */
  markLeadBooked(tenantId: string, leadId: string, at: Date): Promise<LeadRecord | null>;
  /** After a cancellation: back to BOOKING_SENT with a fresh booking window so "never booked" can fire again. */
  unbookLead(tenantId: string, leadId: string, bookBy: Date): Promise<void>;
  assignLead(tenantId: string, leadId: string, assigneeId: string | null): Promise<void>;
  createBooking(tenantId: string, data: NewBooking): Promise<{ id: string; bookingUrl: string }>;
  recordIntakeEvent(tenantId: string, data: IntakeEventInput): Promise<void>;
  /** Appends a message to the contact's conversation on that channel, creating the conversation if needed. */
  recordMessage(tenantId: string, data: NewMessage): Promise<{ conversationId: string; messageId: string }>;
  /** Tenant members holding RECEIVE_LEAD_ALERTS. */
  listAlertRecipients(tenantId: string): Promise<AlertRecipient[]>;
  /** Integration row (with encrypted credentials) for a provider, or null when not connected. */
  findIntegration(tenantId: string, provider: import("@/lib/types").IntegrationProvider): Promise<IntegrationSettings | null>;
  /** Creates or updates the tenant's integration for a provider (one per provider per tenant). Only the fields given change. */
  upsertIntegration(tenantId: string, data: IntegrationUpsert): Promise<IntegrationSettings>;
  /** Resolves which tenant owns an external account on a provider (a Meta page id, an inbound email address). */
  findTenantByIntegrationAccount(provider: import("@/lib/types").IntegrationProvider, externalAccountId: string): Promise<TenantSummary | null>;
  /**
   * Resolves which active tenant owns an active social channel by the platform's own account id
   * (an Instagram business account id, a GBP location name). For Instagram the id may sit in
   * `settings.igUserId` rather than `externalAccountId`; both are matched. Meta's `instagram`
   * webhooks carry this id, not the Facebook page id the META integration is keyed by.
   */
  findTenantByChannelAccount(platform: SocialPlatform, externalAccountId: string): Promise<TenantSummary | null>;

  // --- bookings ---------------------------------------------------------------------
  findBookingById(tenantId: string, bookingId: string): Promise<BookingRecord | null>;
  /** Latest booking for a lead, if any. */
  findLatestBookingForLead(tenantId: string, leadId: string): Promise<BookingRecord | null>;
  listBookings(tenantId: string, opts: { status?: BookingStatus[]; startsBefore?: Date; startsAfter?: Date; endsBefore?: Date; limit?: number }): Promise<BookingRecord[]>;
  updateBooking(tenantId: string, bookingId: string, patch: BookingPatch): Promise<BookingRecord | null>;

  // --- scheduled actions, requests, reviews, form sessions, conversations, contacts --------
  scheduleAction(tenantId: string, data: NewScheduledAction): Promise<{ record: ScheduledActionRecord; created: boolean }>;
  /** Pending actions across all tenants whose time has come (read-only; the tick claims them with claimAction). */
  listDueActions(now: Date, limit?: number): Promise<ScheduledActionRecord[]>;
  /** Atomically moves a PENDING (or stale RUNNING) action to RUNNING. False when another worker got it first. */
  claimAction(actionId: string, now: Date, leaseMs: number): Promise<boolean>;
  /** DONE/CANCELLED/FAILED finish the action; PENDING re-queues it at `retryAt`. */
  completeAction(actionId: string, status: Exclude<ScheduledActionStatus, "RUNNING">, error?: string | null, retryAt?: Date): Promise<void>;
  /** Outbound automated messages this tenant sent since `since`, optionally to one destination. */
  countOutboundMessages(tenantId: string, opts: { since: Date; to?: string }): Promise<number>;
  cancelActions(tenantId: string, dedupePrefix: string): Promise<number>;

  createInformationRequest(tenantId: string, data: NewInformationRequest): Promise<InformationRequestRecord>;
  listInformationRequests(tenantId: string, opts?: { status?: InformationRequestStatus[]; limit?: number }): Promise<InformationRequestRecord[]>;
  findInformationRequestById(tenantId: string, requestId: string): Promise<InformationRequestRecord | null>;
  updateInformationRequest(tenantId: string, requestId: string, patch: { status?: InformationRequestStatus; chaseCount?: number; lastChasedAt?: Date; receivedAt?: Date }): Promise<InformationRequestRecord | null>;

  upsertReview(tenantId: string, data: NewReview): Promise<{ record: ReviewRecord; created: boolean }>;
  listReviews(tenantId: string, opts?: { unansweredOnly?: boolean; receivedBefore?: Date; limit?: number }): Promise<ReviewRecord[]>;
  markReviewReplied(tenantId: string, reviewId: string, replyBody: string | null): Promise<ReviewRecord | null>;

  upsertFormSession(tenantId: string, data: { sessionKey: string; formName: string | null; pageUrl: string | null; partial: Record<string, unknown> }): Promise<FormSessionRecord>;
  /** Sessions last touched before idleBefore, never submitted, never flagged, with some contact detail captured. */
  listAbandonedFormSessions(tenantId: string, idleBefore: Date, limit?: number): Promise<FormSessionRecord[]>;
  updateFormSession(tenantId: string, sessionKey: string, patch: { submittedAt?: Date; convertedLeadId?: string; flaggedAt?: Date }): Promise<void>;

  listConversationsAwaitingReply(tenantId: string, opts: { channels: ConversationRecord["channel"][]; olderThan: Date; limit?: number }): Promise<ConversationRecord[]>;

  findContactById(tenantId: string, contactId: string): Promise<ContactRecord | null>;
  /** Contacts who have bought or won before, inactive since inactiveBefore, not yet marked lapsed. */
  listLapsedCandidates(tenantId: string, inactiveBefore: Date, limit?: number): Promise<ContactRecord[]>;
  markContactLapsed(tenantId: string, contactId: string, at: Date | null): Promise<void>;
  setContactConsent(tenantId: string, contactId: string, channel: "sms" | "email" | "whatsapp", granted: boolean, source: string): Promise<void>;

  /** Leads sitting in a stage with quietAfterDays set, with no activity for that long. */
  listLeadsQuietInStage(tenantId: string, now: Date): Promise<{ lead: LeadRecord; stageName: string; quietDays: number }[]>;
  touchLead(tenantId: string, leadId: string, at: Date): Promise<void>;

  // --- missed opportunities, automation, exceptions, events ----------------------------
  /**
   * Creates the item unless an open one with the same dedupeKey exists. An item
   * resolved within the last `snoozeDays` (default 7) is not re-raised either, so
   * closing something an operator has looked at sticks; older ones reopen.
   */
  upsertMissedOpportunity(tenantId: string, data: NewMissedOpportunity): Promise<{ record: MissedOpportunityRecord; created: boolean }>;
  /** `onlyAssigneeId` limits the list to items on leads assigned to that user (a member without VIEW_ALL_RECORDS). */
  listMissedOpportunities(tenantId: string, opts?: { status?: MissedOpportunityStatus[]; limit?: number; onlyAssigneeId?: string | null }): Promise<MissedOpportunityRecord[]>;
  /** Also closes the exception attached to the item when the status is terminal (RECOVERED/EXPIRED). */
  resolveMissedOpportunity(tenantId: string, id: string, status: MissedOpportunityStatus, recoveredValueCents?: number): Promise<MissedOpportunityRecord | null>;
  /** Resolves the open item for a dedupe key, if any (used when the thing it flagged has just happened). */
  resolveMissedOpportunityByKey(tenantId: string, dedupeKey: string, status: "RECOVERED" | "EXPIRED", recoveredValueCents?: number): Promise<MissedOpportunityRecord | null>;
  recordAutomationRun(tenantId: string, data: NewAutomationRun): Promise<AutomationRunRecord>;
  /** Corrects a run after the fact (a send that failed after the run was logged). */
  updateAutomationRun(tenantId: string, runId: string, patch: { outcome: AutomationOutcome; summary: string; details?: Record<string, unknown> }): Promise<void>;
  listAutomationRuns(tenantId: string, limit?: number, opts?: { onlyAssigneeId?: string | null }): Promise<AutomationRunRecord[]>;
  /** Creates the exception, or reopens the one already attached to the same missed opportunity. */
  createException(tenantId: string, data: NewException): Promise<ExceptionRecord>;
  /** Across several tenants for the operator queue. */
  listExceptions(tenantIds: string[], opts?: { status?: ExceptionStatus[]; limit?: number }): Promise<ExceptionRecord[]>;
  resolveException(tenantId: string, id: string, resolution: string): Promise<ExceptionRecord | null>;
  appendEvent(tenantId: string, type: string, payload?: Record<string, unknown>, causationId?: string | null): Promise<DomainEventRecord>;
  listEvents(tenantId: string, limit?: number): Promise<DomainEventRecord[]>;

  // --- content and money -----------------------------------------------------------
  getWorkbench(tenantId: string): Promise<Workbench>;
  createContentAssets(tenantId: string, items: NewContentAsset[]): Promise<ContentAssetRecord[]>;
  findContentAssetById(tenantId: string, assetId: string): Promise<ContentAssetRecord | null>;
  listContentAssets(tenantId: string, opts?: { status?: ContentStatus[]; kinds?: string[]; parentId?: string | null; limit?: number }): Promise<ContentAssetRecord[]>;
  updateContentAssetStatus(tenantId: string, assetId: string, status: ContentStatus, note?: string | null): Promise<ContentAssetRecord | null>;
  updateContentAsset(tenantId: string, assetId: string, patch: ContentAssetPatch): Promise<ContentAssetRecord | null>;

  // --- social: channels, posts, metrics, inbox ----------------------------------------
  listChannels(tenantId: string, opts?: { activeOnly?: boolean }): Promise<ChannelRecord[]>;
  /** Creates or updates the channel for (platform, externalAccountId). */
  upsertChannel(tenantId: string, data: NewChannel): Promise<ChannelRecord>;
  createSocialPosts(tenantId: string, items: NewSocialPost[]): Promise<SocialPostRecord[]>;
  listSocialPosts(tenantId: string, opts?: { status?: PostStatus[]; from?: Date; to?: Date; limit?: number }): Promise<SocialPostRecord[]>;
  findSocialPostById(tenantId: string, postId: string): Promise<SocialPostRecord | null>;
  updateSocialPost(tenantId: string, postId: string, patch: SocialPostPatch): Promise<SocialPostRecord | null>;
  /** SCHEDULED posts across all tenants whose time has come (read-only; claim with claimSocialPost). */
  listDueSocialPosts(now: Date, limit?: number): Promise<SocialPostRecord[]>;
  /** Atomically moves a SCHEDULED (or stale PUBLISHING) post to PUBLISHING. False when another worker got it first. */
  claimSocialPost(postId: string, now: Date, leaseMs: number): Promise<boolean>;
  recordChannelMetrics(tenantId: string, data: NewChannelMetrics): Promise<void>;
  listChannelMetrics(tenantId: string, opts: { since: Date; channelId?: string }): Promise<ChannelMetricSnapshotRecord[]>;
  /** One thread per provider thread id per channel; returns the existing thread when it already exists. */
  upsertSocialConversation(tenantId: string, data: NewSocialConversation): Promise<{ record: ConversationRecord; created: boolean }>;
  listInboxConversations(tenantId: string, opts?: { awaitingOnly?: boolean; limit?: number }): Promise<ConversationRecord[]>;
  findConversationById(tenantId: string, conversationId: string): Promise<ConversationRecord | null>;
  listMessages(tenantId: string, conversationId: string, limit?: number): Promise<MessageRecord[]>;
  /** True when a message with this provider id is already on the conversation (webhook and poll dedupe). */
  hasMessageWithProviderId(tenantId: string, conversationId: string, providerMessageId: string): Promise<boolean>;
  updateConversation(tenantId: string, conversationId: string, patch: { awaitingReply?: boolean; suggestedReply?: string | null; meta?: Record<string, unknown> }): Promise<void>;
  listRecentTransactions(tenantId: string, limit?: number): Promise<TransactionRecord[]>;

  // --- provisioning, people, keys, inventory (Phase 5) ------------------------------
  createTenant(data: NewTenant): Promise<TenantSummary>;
  updateTenant(tenantId: string, patch: TenantPatch): Promise<TenantSummary | null>;
  /** Applies a template's roles, pipelines, modules, automations and brand profile. Idempotent; existing rows are updated to the template. */
  applyTemplate(tenantId: string, template: IndustryTemplate): Promise<void>;
  setModule(tenantId: string, moduleKey: string, patch: { enabled?: boolean; settings?: Record<string, unknown> }): Promise<void>;
  setAutomation(tenantId: string, typeKey: string, patch: { enabled?: boolean; settings?: Record<string, unknown> }): Promise<void>;
  updateBrandProfile(tenantId: string, patch: Partial<BrandProfileRecord>): Promise<void>;
  listTenantPeople(tenantId: string): Promise<TenantPersonRecord[]>;
  createUser(data: NewUser): Promise<UserRecord>;
  /** Replaces the password and bumps sessionVersion so every existing session ends. */
  setUserPassword(userId: string, passwordHash: string): Promise<void>;
  upsertMembership(tenantId: string, userId: string, roleId: string, profile?: MemberProfile): Promise<void>;

  // Platform liveness and counters shared by every instance (not tenant data).
  /** True when the database answers within a few seconds; demo mode always answers. */
  ping(): Promise<boolean>;
  recordHeartbeat(key: string, at: Date): Promise<void>;
  getHeartbeat(key: string): Promise<Date | null>;
  /** Counts one hit in a fixed window; the count restarts when the window has passed. Atomic across instances. */
  rateLimitHit(key: string, windowMs: number, now?: Date): Promise<{ count: number; windowStart: Date }>;
  /** The current count without adding to it (0 once the window has passed). */
  rateLimitPeek(key: string, windowMs: number, now?: Date): Promise<number>;
  rateLimitClear(key: string): Promise<void>;

  // Client onboarding questionnaires: platform-level, sent before a workspace exists.
  createOnboarding(data: { tokenHash: string; label: string; contactEmail?: string | null; createdById?: string | null; expiresAt: Date }): Promise<OnboardingRecord>;
  findOnboardingByTokenHash(tokenHash: string): Promise<OnboardingRecord | null>;
  findOnboardingById(id: string): Promise<OnboardingRecord | null>;
  listOnboardings(opts?: { limit?: number }): Promise<OnboardingRecord[]>;
  updateOnboarding(id: string, patch: { answers?: Record<string, unknown>; status?: OnboardingStatus; tokenHash?: string; expiresAt?: Date; startedAt?: Date | null; submittedAt?: Date | null; provisionedAt?: Date | null; tenantId?: string | null }): Promise<OnboardingRecord | null>;
  removeMembership(tenantId: string, userId: string): Promise<void>;
  assignOperator(tenantId: string, userId: string): Promise<void>;
  listOperators(): Promise<UserRecord[]>;
  createApiKey(tenantId: string, data: NewApiKey): Promise<ApiKeyRecord>;
  listApiKeys(tenantId: string): Promise<ApiKeyRecord[]>;
  revokeApiKey(tenantId: string, keyId: string): Promise<void>;
  listInventory(tenantId: string, opts?: { type?: InventoryType; status?: InventoryStatus[]; limit?: number }): Promise<InventoryItemRecord[]>;
  /** Upserts on externalId when given, else on (type, name). Returns the ids of rows that were new. */
  upsertInventoryItems(tenantId: string, items: NewInventoryItem[]): Promise<{ created: InventoryItemRecord[]; updated: number }>;

  // --- ads, attribution, finance, website (Phase 4) ------------------------------------
  listAdAccounts(tenantId: string, opts?: { activeOnly?: boolean }): Promise<AdAccountRecord[]>;
  upsertAdAccount(tenantId: string, data: NewAdAccount): Promise<AdAccountRecord>;
  updateAdAccount(tenantId: string, adAccountId: string, patch: AdAccountPatch): Promise<void>;
  /** Upserts daily rows keyed on (account, date, campaign). Returns how many rows were written. */
  recordAdSpend(tenantId: string, rows: NewAdSpend[]): Promise<number>;
  listAdSpend(tenantId: string, opts: { from: Date; to?: Date; adAccountId?: string }): Promise<AdSpendSnapshotRecord[]>;
  /** Total spend in cents between the dates (inclusive of from, exclusive of to). */
  /** Spend in cents; with `currency`, only snapshots of ad accounts billed in that currency, so the money panel never mixes currencies. */
  sumAdSpend(tenantId: string, from: Date, to?: Date, currency?: string): Promise<number>;
  /** Leads created in the window, with attribution, for the attribution report (capped). */
  listLeadsBetween(tenantId: string, from: Date, to?: Date, limit?: number): Promise<LeadRecord[]>;
  /** Upserts on (provider, providerId); links a contact by customerEmail when none is given. Returns how many were new. */
  upsertTransactions(tenantId: string, rows: NewTransaction[]): Promise<number>;
  listTransactions(tenantId: string, opts: { from: Date; to?: Date; status?: TransactionStatus[]; kinds?: TransactionKind[]; limit?: number }): Promise<TransactionRecord[]>;
  /** Upserts on (provider, externalId). Returns the invoices that just became PAID so a thank-you can go out. */
  upsertInvoices(tenantId: string, rows: NewInvoice[]): Promise<{ written: number; paidNow: InvoiceRecord[] }>;
  listInvoices(tenantId: string, opts?: { status?: InvoiceStatus[]; dueBefore?: Date; limit?: number }): Promise<InvoiceRecord[]>;
  updateInvoice(tenantId: string, invoiceId: string, patch: { status?: InvoiceStatus; remindersSent?: number; lastReminderAt?: Date | null; paidAt?: Date | null; contactId?: string | null }): Promise<void>;
  createTrackedLink(tenantId: string, data: NewTrackedLink): Promise<TrackedLinkRecord>;
  listTrackedLinks(tenantId: string, limit?: number): Promise<TrackedLinkRecord[]>;
  /** Codes are globally unique, so the redirect resolves the tenant from the link. */
  findTrackedLinkByCode(code: string): Promise<TrackedLinkRecord | null>;
  incrementTrackedLinkClicks(linkId: string): Promise<void>;
  recordWebEvents(tenantId: string, events: NewWebEvent[]): Promise<void>;
  listWebEvents(tenantId: string, from: Date, to: Date, limit?: number): Promise<WebEventRecord[]>;
  pruneWebEvents(tenantId: string, before: Date): Promise<number>;
  recordSiteMetrics(tenantId: string, data: NewSiteMetrics): Promise<void>;
  listSiteMetrics(tenantId: string, since: Date): Promise<SiteMetricSnapshotRecord[]>;

  // --- read models for the two surfaces --------------------------------------------------
  getPortalHome(tenantId: string, opts: PortalHomeOptions): Promise<PortalHome>;
  getPortfolio(tenants: TenantSummary[], now?: Date): Promise<PortfolioRow[]>;
}
