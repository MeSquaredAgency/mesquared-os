import { randomUUID } from "node:crypto";
import type { LeadRecord, TaskRecord, TransactionRecord, ContentAssetRecord, SocialPostRecord, TenantSummary } from "@/lib/types";
import type { IntakeEventInput, NewBooking, Repository } from "./repository";
import {
  demoApiKeyHashes,
  demoAssets,
  demoConnections,
  demoLeads,
  demoPosts,
  demoTasks,
  demoTenants,
  demoTransactions,
} from "./fixtures";

interface MemoryStore {
  tenants: TenantSummary[];
  leads: LeadRecord[];
  tasks: TaskRecord[];
  transactions: TransactionRecord[];
  assets: ContentAssetRecord[];
  posts: SocialPostRecord[];
  bookings: { id: string; tenantId: string; leadId: string; bookingUrl: string }[];
  intakeEvents: (IntakeEventInput & { id: string; tenantId: string; createdAt: Date })[];
}

const g = globalThis as unknown as { __msqMemoryStore?: MemoryStore };

function store(): MemoryStore {
  if (!g.__msqMemoryStore) {
    g.__msqMemoryStore = {
      tenants: [...demoTenants],
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

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const byNewest = <T extends { createdAt: Date }>(a: T, b: T) => b.createdAt.getTime() - a.createdAt.getTime();

/** In-memory repository backed by demo fixtures. Used when DATABASE_URL is unset. */
export const memoryRepository: Repository = {
  async listTenants() {
    return store().tenants;
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
    store().leads.unshift(lead);
    return lead;
  },

  async createTask(tenantId, data) {
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
    store().tasks.unshift(task);
    return task;
  },

  async createBooking(tenantId, data: NewBooking) {
    const booking = { id: `bk_${randomUUID().slice(0, 8)}`, tenantId, ...data };
    store().bookings.push(booking);
    const lead = store().leads.find((l) => l.id === data.leadId && l.tenantId === tenantId);
    if (lead) lead.status = "BOOKING_SENT";
    return { id: booking.id, bookingUrl: booking.bookingUrl };
  },

  async recordIntakeEvent(tenantId, data) {
    store().intakeEvents.push({ ...data, id: randomUUID(), tenantId, createdAt: new Date() });
  },

  async getTicketBoard(tenantId) {
    const s = store();
    const today = startOfToday().getTime();
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
          .filter((t) => t.tenantId === tenantId && t.status === "COMPLETED" && t.occurredAt.getTime() >= today)
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
};
