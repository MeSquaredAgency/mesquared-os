import type {
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
  ExceptionRecord,
  ExceptionStatus,
  FormSessionRecord,
  InformationRequestRecord,
  InformationRequestStatus,
  IntegrationRecord,
  LeadRecord,
  LeadSource,
  MessageRecord,
  MissedOpportunityRecord,
  MissedOpportunityStatus,
  MissedOpportunityType,
  PipelineRecord,
  PortalHome,
  PortfolioRow,
  PostStatus,
  ReviewRecord,
  ScheduledActionRecord,
  ScheduledActionStatus,
  SocialPlatform,
  SocialPostRecord,
  TenantAccess,
  TenantAutomationRecord,
  TenantModuleRecord,
  TenantRoleRecord,
  TenantSummary,
  TicketType,
  TransactionRecord,
  UserRecord,
} from "@/lib/types";

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

export type ApiKeyScope = "intake" | "content";

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
  listMissedOpportunities(tenantId: string, opts?: { status?: MissedOpportunityStatus[]; limit?: number }): Promise<MissedOpportunityRecord[]>;
  /** Also closes the exception attached to the item when the status is terminal (RECOVERED/EXPIRED). */
  resolveMissedOpportunity(tenantId: string, id: string, status: MissedOpportunityStatus, recoveredValueCents?: number): Promise<MissedOpportunityRecord | null>;
  /** Resolves the open item for a dedupe key, if any (used when the thing it flagged has just happened). */
  resolveMissedOpportunityByKey(tenantId: string, dedupeKey: string, status: "RECOVERED" | "EXPIRED", recoveredValueCents?: number): Promise<MissedOpportunityRecord | null>;
  recordAutomationRun(tenantId: string, data: NewAutomationRun): Promise<AutomationRunRecord>;
  /** Corrects a run after the fact (a send that failed after the run was logged). */
  updateAutomationRun(tenantId: string, runId: string, patch: { outcome: AutomationOutcome; summary: string; details?: Record<string, unknown> }): Promise<void>;
  listAutomationRuns(tenantId: string, limit?: number): Promise<AutomationRunRecord[]>;
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

  // --- read models for the two surfaces --------------------------------------------------
  getPortalHome(tenantId: string, opts: PortalHomeOptions): Promise<PortalHome>;
  getPortfolio(tenants: TenantSummary[], now?: Date): Promise<PortfolioRow[]>;
}
