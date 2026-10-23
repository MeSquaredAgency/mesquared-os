import type {
  UserRecord,
  ContentAssetRecord,
  LeadRecord,
  LeadSource,
  SocialPlatform,
  SocialPostRecord,
  TaskPriority,
  TaskRecord,
  TenantSummary,
  TicketBoardStats,
  TicketType,
  TransactionRecord,
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
  rawPayload: Record<string, unknown>;
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
}

export interface IntakeEventInput {
  leadId: string | null;
  source: LeadSource;
  outcome: "created" | "duplicate" | "rejected";
  payload: Record<string, unknown>;
  classifier: string | null;
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

/**
 * Every query is tenant-scoped by construction: callers pass the tenantId
 * and implementations must never return rows from another tenant.
 */
export interface Repository {
  listTenants(): Promise<TenantSummary[]>;
  /** Tenants the user may operate. Platform admins see every active tenant. */
  listTenantsForUser(userId: string): Promise<TenantSummary[]>;
  findUserById(id: string): Promise<UserRecord | null>;
  findUserByEmail(email: string): Promise<{ user: UserRecord; passwordHash: string | null } | null>;
  findTenantByApiKeyHash(hash: string): Promise<{ tenant: TenantSummary; apiKeyId: string | null } | null>;

  findDuplicateLead(tenantId: string, probe: { externalId: string | null; email: string | null; phone: string | null }): Promise<LeadRecord | null>;
  createLead(tenantId: string, data: NewLead): Promise<LeadRecord>;
  createTask(tenantId: string, data: NewTask): Promise<TaskRecord>;
  createBooking(tenantId: string, data: NewBooking): Promise<{ id: string; bookingUrl: string }>;
  recordIntakeEvent(tenantId: string, data: IntakeEventInput): Promise<void>;

  getTicketBoard(tenantId: string): Promise<TicketBoard>;
  listRecentLeads(tenantId: string, limit?: number): Promise<LeadRecord[]>;
  listRecentTransactions(tenantId: string, limit?: number): Promise<TransactionRecord[]>;
  getWorkbench(tenantId: string): Promise<Workbench>;
}
