import type {
  AutomationOutcome,
  AutomationRunRecord,
  BrandProfileRecord,
  ContactRecord,
  ContentAssetRecord,
  ContentStatus,
  DomainEventRecord,
  ExceptionRecord,
  ExceptionStatus,
  IntegrationRecord,
  LeadRecord,
  LeadSource,
  MissedOpportunityRecord,
  MissedOpportunityStatus,
  MissedOpportunityType,
  PipelineRecord,
  PortalHome,
  PortfolioRow,
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
  assets: ContentAssetRecord[];
  posts: SocialPostRecord[];
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
  findTenantByApiKeyHash(hash: string): Promise<{ tenant: TenantSummary; apiKeyId: string | null } | null>;

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
  markLeadResponded(tenantId: string, leadId: string, at: Date): Promise<void>;
  createBooking(tenantId: string, data: NewBooking): Promise<{ id: string; bookingUrl: string }>;
  recordIntakeEvent(tenantId: string, data: IntakeEventInput): Promise<void>;

  // --- missed opportunities, automation, exceptions, events ----------------------------
  /** Creates the item unless an open one with the same dedupeKey exists. */
  upsertMissedOpportunity(tenantId: string, data: NewMissedOpportunity): Promise<{ record: MissedOpportunityRecord; created: boolean }>;
  listMissedOpportunities(tenantId: string, opts?: { status?: MissedOpportunityStatus[]; limit?: number }): Promise<MissedOpportunityRecord[]>;
  resolveMissedOpportunity(tenantId: string, id: string, status: MissedOpportunityStatus, recoveredValueCents?: number): Promise<MissedOpportunityRecord | null>;
  recordAutomationRun(tenantId: string, data: NewAutomationRun): Promise<AutomationRunRecord>;
  listAutomationRuns(tenantId: string, limit?: number): Promise<AutomationRunRecord[]>;
  createException(tenantId: string, data: NewException): Promise<ExceptionRecord>;
  /** Across several tenants for the operator queue. */
  listExceptions(tenantIds: string[], opts?: { status?: ExceptionStatus[]; limit?: number }): Promise<ExceptionRecord[]>;
  resolveException(tenantId: string, id: string, resolution: string): Promise<ExceptionRecord | null>;
  appendEvent(tenantId: string, type: string, payload?: Record<string, unknown>, causationId?: string | null): Promise<DomainEventRecord>;
  listEvents(tenantId: string, limit?: number): Promise<DomainEventRecord[]>;

  // --- content and money -----------------------------------------------------------
  getWorkbench(tenantId: string): Promise<Workbench>;
  createContentAssets(tenantId: string, items: NewContentAsset[]): Promise<ContentAssetRecord[]>;
  updateContentAssetStatus(tenantId: string, assetId: string, status: ContentStatus, note?: string | null): Promise<ContentAssetRecord | null>;
  listRecentTransactions(tenantId: string, limit?: number): Promise<TransactionRecord[]>;

  // --- read models for the two surfaces --------------------------------------------------
  getPortalHome(tenantId: string, opts: PortalHomeOptions): Promise<PortalHome>;
  getPortfolio(tenants: TenantSummary[], now?: Date): Promise<PortfolioRow[]>;
}
