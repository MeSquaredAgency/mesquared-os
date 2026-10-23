import { randomUUID } from "node:crypto";
import type {
  ContentAssetRecord,
  LeadRecord,
  MembershipRole,
  SocialPostRecord,
  TaskRecord,
  TenantSummary,
  TransactionRecord,
  UserRecord,
} from "@/lib/types";
import { startOfDayInZone } from "@/lib/utils";
import { TenantMismatchError, type IntakeEventInput, type NewBooking, type NewContentAsset, type Repository } from "./repository";
import {
  demoApiKeyHashes,
  demoAssets,
  demoConnections,
  demoLeads,
  demoMemberships,
  demoPosts,
  demoTasks,
  demoTenants,
  demoTransactions,
  getDemoUsers,
} from "./fixtures";

interface MemoryStore {
  tenants: TenantSummary[];
  users: (UserRecord & { passwordHash: string })[];
  leads: LeadRecord[];
  tasks: TaskRecord[];
  transactions: TransactionRecord[];
  assets: ContentAssetRecord[];
  posts: SocialPostRecord[];
  bookings: { id: string; tenantId: string; leadId: string; bookingUrl: string; sent: boolean }[];
  intakeEvents: (IntakeEventInput & { id: string; tenantId: string; createdAt: Date })[];
}

/** Keeps demo memory bounded if a long-running dev server receives a lot of traffic. */
const MAX_ROWS = 5000;

const g = globalThis as unknown as { __msqMemoryStore?: MemoryStore };

function store(): MemoryStore {
  if (!g.__msqMemoryStore) {
    g.__msqMemoryStore = {
      tenants: [...demoTenants],
      users: [...getDemoUsers()],
      leads: [...demoLeads],
      tasks: [...demoTasks],
      transactions: [...demoTransactions],
      assets: [...demoAssets],
      posts: [...demoPosts],
      bookings: [],
      intakeEvents: [],
    };
  }
  return g.__msqMemoryStore;
}

function pushBounded<T>(list: T[], item: T, front = true) {
  if (front) list.unshift(item);
  else list.push(item);
  if (list.length > MAX_ROWS) list.length = MAX_ROWS;
}

const byNewest = <T extends { createdAt: Date }>(a: T, b: T) => b.createdAt.getTime() - a.createdAt.getTime();

const publicUser = (u: UserRecord & { passwordHash: string }): UserRecord => ({
  id: u.id,
  email: u.email,
  name: u.name,
  isPlatformAdmin: u.isPlatformAdmin,
  sessionVersion: u.sessionVersion,
});

function assertLeadInTenant(tenantId: string, leadId: string | null) {
  if (!leadId) return;
  const lead = store().leads.find((l) => l.id === leadId);
  if (!lead || lead.tenantId !== tenantId) throw new TenantMismatchError("Lead", leadId);
}

/** In-memory repository backed by demo fixtures. Used when DATABASE_URL is unset. */
export const memoryRepository: Repository = {
  async listTenants() {
    return store().tenants;
  },

  async listTenantsForUser(userId) {
    const user = store().users.find((u) => u.id === userId);
    if (!user) return [];
    if (user.isPlatformAdmin) return store().tenants.map((t) => ({ ...t, role: "OWNER" as MembershipRole }));
    const memberships = demoMemberships[userId] ?? [];
    return store()
      .tenants.filter((t) => memberships.some((m) => m.tenantId === t.id))
      .map((t) => ({ ...t, role: memberships.find((m) => m.tenantId === t.id)!.role }));
  },

  async findUserById(id) {
    const u = store().users.find((x) => x.id === id);
    return u ? publicUser(u) : null;
  },

  async findUserByEmail(email) {
    const u = store().users.find((x) => x.email === email.toLowerCase());
    return u ? { user: publicUser(u), passwordHash: u.passwordHash } : null;
  },

  async findTenantByApiKeyHash(hash) {
    const tenantId = demoApiKeyHashes[hash];
    const tenant = tenantId ? store().tenants.find((t) => t.id === tenantId) : undefined;
    return tenant ? { tenant, apiKeyId: null } : null;
  },

  async findDuplicateLead(tenantId, probe) {
    const leads = store().leads.filter((l) => l.tenantId === tenantId);
    if (probe.externalId) {
      const hit = leads.find((l) => l.externalId === probe.externalId);
      if (hit) return hit;
    }
    const cutoff = Date.now() - 24 * 60 * 60_000;
    return (
      leads.find(
        (l) =>
          l.createdAt.getTime() > cutoff &&
          ((probe.email && l.email === probe.email) || (probe.phone && l.phone === probe.phone)),
      ) ?? null
    );
  },

  async createLead(tenantId, data) {
    if (data.externalId) {
      const existing = store().leads.find((l) => l.tenantId === tenantId && l.externalId === data.externalId);
      if (existing) return { lead: existing, created: false };
    }
    const lead: LeadRecord = {
      id: `lead_${randomUUID().slice(0, 8)}`,
      tenantId,
      source: data.source,
      externalId: data.externalId,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      phone: data.phone,
      company: data.company,
      message: data.message,
      attributes: data.attributes,
      status: data.ticketType === "GREEN" ? "QUALIFIED" : "NURTURING",
      ticketType: data.ticketType,
      intentScore: data.intentScore,
      qualificationReason: data.qualificationReason,
      qualifiedBy: data.qualifiedBy,
      createdAt: new Date(),
    };
    pushBounded(store().leads, lead);
    return { lead, created: true };
  },

  async createTask(tenantId, data) {
    assertLeadInTenant(tenantId, data.leadId);
    const task: TaskRecord = {
      id: `task_${randomUUID().slice(0, 8)}`,
      tenantId,
      leadId: data.leadId,
      type: data.type,
      title: data.title,
      description: data.description,
      status: "OPEN",
      priority: data.priority,
      dueAt: data.dueAt,
      automationKey: data.automationKey,
      createdAt: new Date(),
    };
    pushBounded(store().tasks, task);
    return task;
  },

  async createBooking(tenantId, data: NewBooking) {
    assertLeadInTenant(tenantId, data.leadId);
    const booking = { id: `bk_${randomUUID().slice(0, 8)}`, tenantId, ...data };
    pushBounded(store().bookings, booking, false);
    if (data.sent) {
      const lead = store().leads.find((l) => l.id === data.leadId && l.tenantId === tenantId);
      if (lead) lead.status = "BOOKING_SENT";
    }
    return { id: booking.id, bookingUrl: booking.bookingUrl };
  },

  async recordIntakeEvent(tenantId, data) {
    assertLeadInTenant(tenantId, data.leadId);
    pushBounded(store().intakeEvents, { ...data, id: randomUUID(), tenantId, createdAt: new Date() }, false);
  },

  async getTicketBoard(tenantId, { timezone, currency }) {
    const s = store();
    const today = startOfDayInZone(timezone).getTime();
    const tasks = s.tasks.filter((t) => t.tenantId === tenantId);
    const leads = s.leads.filter((l) => l.tenantId === tenantId);
    const open = (t: TaskRecord) => t.status !== "DONE" && t.status !== "CANCELLED";
    const greenTasks = tasks.filter((t) => t.type === "GREEN").sort(byNewest);
    const redTasks = tasks.filter((t) => t.type === "RED").sort(byNewest);
    const greenLeads = leads.filter((l) => l.ticketType === "GREEN").sort(byNewest);
    const redLeads = leads.filter((l) => l.ticketType === "RED").sort(byNewest);
    return {
      stats: {
        greenOpen: greenTasks.filter(open).length,
        redOpen: redTasks.filter(open).length,
        greenLeadsToday: greenLeads.filter((l) => l.createdAt.getTime() >= today).length,
        redLeadsToday: redLeads.filter((l) => l.createdAt.getTime() >= today).length,
        bookingsPending: leads.filter((l) => l.status === "BOOKING_SENT").length,
        revenueTodayCents: s.transactions
          .filter((t) => t.tenantId === tenantId && t.status === "COMPLETED" && t.currency === currency && t.occurredAt.getTime() >= today)
          .reduce((sum, t) => sum + t.amountCents, 0),
      },
      greenTasks,
      redTasks,
      greenLeads,
      redLeads,
    };
  },

  async listRecentLeads(tenantId, limit = 25) {
    return store().leads.filter((l) => l.tenantId === tenantId).sort(byNewest).slice(0, limit);
  },

  async listRecentTransactions(tenantId, limit = 25) {
    return store()
      .transactions.filter((t) => t.tenantId === tenantId)
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, limit);
  },

  async getWorkbench(tenantId) {
    const s = store();
    return {
      assets: s.assets.filter((a) => a.tenantId === tenantId).sort(byNewest),
      posts: s.posts.filter((p) => p.tenantId === tenantId),
      connectedPlatforms: demoConnections[tenantId] ?? [],
    };
  },

  async createContentAssets(tenantId, items: NewContentAsset[]) {
    const created = items.map((item) => ({
      id: `asset_${randomUUID().slice(0, 8)}`,
      tenantId,
      kind: item.kind,
      title: item.title,
      body: item.body,
      targetPlatform: item.targetPlatform,
      status: item.status,
      createdAt: new Date(),
    }));
    for (const asset of created) pushBounded(store().assets, asset);
    return created;
  },

  async updateContentAssetStatus(tenantId, assetId, status) {
    const asset = store().assets.find((a) => a.id === assetId && a.tenantId === tenantId);
    if (!asset) return null;
    asset.status = status;
    return asset;
  },
};
