import type {
  ContentAssetRecord,
  ContentStatus,
  LeadRecord,
  LeadSource,
  SocialPlatform,
  SocialPostRecord,
  TaskPriority,
  TaskRecord,
  TenantAccess,
  TenantSummary,
  TicketBoardStats,
  TicketType,
  TransactionRecord,
  UserRecord,
} from "@/lib/types";

export interface NewLead {
  source: LeadSource;
  externalId: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  message: string | null;
  attributes: Record<string, unknown>;
  ticketType: TicketType;
  intentScore: number;
  qualificationReason: string;
  qualifiedBy: string;
}

export interface NewTask {
  leadId: string | null;
  type: TicketType;
  title: string;
  description: string | null;
  priority: TaskPriority;
  dueAt: Date | null;
  automationKey: string | null;
}

export interface NewBooking {
  leadId: string;
  bookingUrl: string;
  /** True once the messaging adapter has delivered the link to the lead. */
  sent: boolean;
}

export type IntakeOutcome = "CREATED" | "DUPLICATE" | "REJECTED";

export interface IntakeEventInput {
  leadId: string | null;
  source: LeadSource;
  outcome: IntakeOutcome;
  /** Redacted raw request body. */
  payload: Record<string, unknown>;
  classifier: string | null;
}

export interface NewContentAsset {
  kind: string;
  title: string | null;
  body: string | null;
  targetPlatform: SocialPlatform | null;
  status: ContentStatus;
  tags: string[];
  scheduledFor: Date | null;
}

export interface TicketBoard {
  stats: TicketBoardStats;
  greenTasks: TaskRecord[];
  redTasks: TaskRecord[];
  greenLeads: LeadRecord[];
  redLeads: LeadRecord[];
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
  listTenants(): Promise<TenantSummary[]>;
  /** Tenants the user may operate, with their role. Platform admins see every active tenant as OWNER. */
  listTenantsForUser(userId: string): Promise<TenantAccess[]>;
  findUserById(id: string): Promise<UserRecord | null>;
  findUserByEmail(email: string): Promise<{ user: UserRecord; passwordHash: string | null } | null>;
  findTenantByApiKeyHash(hash: string): Promise<{ tenant: TenantSummary; apiKeyId: string | null } | null>;

  findDuplicateLead(tenantId: string, probe: { externalId: string | null; email: string | null; phone: string | null }): Promise<LeadRecord | null>;
  /**
   * Inserts the lead. When another request inserted the same externalId
   * first (race), returns that row with `created: false` instead of failing.
   */
  createLead(tenantId: string, data: NewLead): Promise<{ lead: LeadRecord; created: boolean }>;
  createTask(tenantId: string, data: NewTask): Promise<TaskRecord>;
  createBooking(tenantId: string, data: NewBooking): Promise<{ id: string; bookingUrl: string }>;
  recordIntakeEvent(tenantId: string, data: IntakeEventInput): Promise<void>;

  /** `timezone` decides where "today" starts; `currency` limits revenue totals. */
  getTicketBoard(tenantId: string, opts: { timezone: string; currency: string }): Promise<TicketBoard>;
  listRecentLeads(tenantId: string, limit?: number): Promise<LeadRecord[]>;
  listRecentTransactions(tenantId: string, limit?: number): Promise<TransactionRecord[]>;
  getWorkbench(tenantId: string): Promise<Workbench>;
  createContentAssets(tenantId: string, items: NewContentAsset[]): Promise<ContentAssetRecord[]>;
  /** Returns null when the asset does not belong to the tenant. */
  updateContentAssetStatus(tenantId: string, assetId: string, status: ContentStatus, note?: string | null): Promise<ContentAssetRecord | null>;
}
