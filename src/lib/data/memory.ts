import { randomUUID } from "node:crypto";
import { healthScore } from "@/lib/health";
import type {
  AutomationRunRecord,
  ContactRecord,
  ContentAssetRecord,
  DomainEventRecord,
  ExceptionRecord,
  IntegrationRecord,
  LeadRecord,
  MissedOpportunityRecord,
  PortalHome,
  PortfolioRow,
  SocialPostRecord,
  TenantAccess,
  TenantSummary,
  TransactionRecord,
  UserRecord,
} from "@/lib/types";
import { startOfDayInZone, startOfMonthInZone } from "@/lib/utils";
import {
  TenantMismatchError,
  type IntakeEventInput,
  type NewBooking,
  type NewContentAsset,
  type NewMissedOpportunity,
  type Repository,
} from "./repository";
import {
  demoAdSpendMonthCents,
  demoApiKeyHashes,
  demoAssets,
  demoConfig,
  demoConnectedPlatforms,
  demoContacts,
  demoExceptions,
  demoIntegrations,
  demoLeads,
  demoMemberships,
  demoMissed,
  demoOperatorAssignments,
  demoPosts,
  demoRuns,
  demoTenants,
  demoTransactions,
  getDemoUsers,
} from "./fixtures";

interface MemoryStore {
  tenants: TenantSummary[];
  users: (UserRecord & { passwordHash: string })[];
  contacts: ContactRecord[];
  leads: LeadRecord[];
  bookings: { id: string; tenantId: string; leadId: string; bookingUrl: string; sent: boolean }[];
  intakeEvents: (IntakeEventInput & { id: string; tenantId: string; createdAt: Date })[];
  missed: MissedOpportunityRecord[];
  runs: AutomationRunRecord[];
  exceptions: ExceptionRecord[];
  events: DomainEventRecord[];
  integrations: IntegrationRecord[];
  assets: ContentAssetRecord[];
  posts: SocialPostRecord[];
  transactions: TransactionRecord[];
}

/** Keeps demo memory bounded if a long-running dev server receives a lot of traffic. */
const MAX_ROWS = 5000;

const g = globalThis as unknown as { __msqMemoryStore?: MemoryStore };

function store(): MemoryStore {
  if (!g.__msqMemoryStore) {
    g.__msqMemoryStore = {
      tenants: [...demoTenants],
      users: [...getDemoUsers()],
      contacts: [...demoContacts],
      leads: [...demoLeads],
      bookings: [],
      intakeEvents: [],
      missed: [...demoMissed],
      runs: [...demoRuns],
      exceptions: [...demoExceptions],
      events: [],
      integrations: [...demoIntegrations],
      assets: [...demoAssets],
      posts: [...demoPosts],
      transactions: [...demoTransactions],
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
const id = (prefix: string) => `${prefix}_${randomUUID().slice(0, 8)}`;

const publicUser = (u: UserRecord & { passwordHash: string }): UserRecord => ({
  id: u.id,
  email: u.email,
  name: u.name,
  isOperator: u.isOperator,
  isPlatformAdmin: u.isPlatformAdmin,
  sessionVersion: u.sessionVersion,
});

function assertLeadInTenant(tenantId: string, leadId: string | null | undefined) {
  if (!leadId) return;
  const lead = store().leads.find((l) => l.id === leadId);
  if (!lead || lead.tenantId !== tenantId) throw new TenantMismatchError("Lead", leadId);
}

function assertContactInTenant(tenantId: string, contactId: string | null | undefined) {
  if (!contactId) return;
  const c = store().contacts.find((x) => x.id === contactId);
  if (!c || c.tenantId !== tenantId) throw new TenantMismatchError("Contact", contactId);
}

const OPEN_MISSED = new Set(["DETECTED", "RECOVERING", "ESCALATED"]);

/** In-memory repository backed by demo fixtures. Used when DATABASE_URL is unset. */
export const memoryRepository: Repository = {
  async findUserById(userId) {
    const u = store().users.find((x) => x.id === userId);
    return u ? publicUser(u) : null;
  },

  async findUserByEmail(email) {
    const u = store().users.find((x) => x.email === email.toLowerCase());
    return u ? { user: publicUser(u), passwordHash: u.passwordHash } : null;
  },

  async listTenantAccess(userId) {
    const s = store();
    const user = s.users.find((u) => u.id === userId);
    if (!user) return [];
    const access: TenantAccess[] = [];
    if (user.isPlatformAdmin) {
      for (const tenant of s.tenants) access.push({ tenant, via: "admin", roleName: null, permissions: [] });
      return access;
    }
    for (const a of demoOperatorAssignments.filter((x) => x.userId === userId)) {
      const tenant = s.tenants.find((t) => t.id === a.tenantId);
      if (tenant) access.push({ tenant, via: "operator", roleName: null, permissions: [] });
    }
    for (const m of demoMemberships.filter((x) => x.userId === userId)) {
      const tenant = s.tenants.find((t) => t.id === m.tenantId);
      const role = demoConfig[m.tenantId]?.roles.find((r) => r.id === m.roleId);
      if (tenant && role && !access.some((x) => x.tenant.id === tenant.id)) {
        access.push({ tenant, via: "member", roleName: role.name, permissions: role.permissions });
      }
    }
    return access;
  },

  async findTenantBySlug(slug) {
    return store().tenants.find((t) => t.slug === slug) ?? null;
  },

  async findTenantByApiKeyHash(hash) {
    const tenantId = demoApiKeyHashes[hash];
    const tenant = tenantId ? store().tenants.find((t) => t.id === tenantId) : undefined;
    return tenant ? { tenant, apiKeyId: null } : null;
  },

  async getTenantConfig(tenantId) {
    const cfg = demoConfig[tenantId];
    return {
      modules: cfg?.modules ?? [],
      automations: cfg?.automations ?? [],
      integrations: store().integrations.filter((i) => i.tenantId === tenantId),
      pipelines: cfg?.pipelines ?? [],
      roles: cfg?.roles ?? [],
      brand: cfg?.brand ?? null,
    };
  },

  async upsertContact(tenantId, data) {
    const s = store();
    const existing = s.contacts.find(
      (c) => c.tenantId === tenantId && ((data.email && c.email === data.email) || (data.phone && c.phone === data.phone)),
    );
    if (existing) {
      existing.lastActivityAt = new Date();
      existing.firstName ??= data.firstName;
      existing.lastName ??= data.lastName;
      existing.email ??= data.email;
      existing.phone ??= data.phone;
      existing.company ??= data.company;
      return existing;
    }
    const contact: ContactRecord = { id: id("ct"), tenantId, ...data, tags: [], lastActivityAt: new Date(), lapsedAt: null, createdAt: new Date() };
    pushBounded(s.contacts, contact);
    return contact;
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
        (l) => l.createdAt.getTime() > cutoff && ((probe.email && l.email === probe.email) || (probe.phone && l.phone === probe.phone)),
      ) ?? null
    );
  },

  async createLead(tenantId, data) {
    assertContactInTenant(tenantId, data.contactId);
    if (data.externalId) {
      const existing = store().leads.find((l) => l.tenantId === tenantId && l.externalId === data.externalId);
      if (existing) return { lead: existing, created: false };
    }
    const lead: LeadRecord = {
      id: id("lead"),
      tenantId,
      contactId: data.contactId,
      pipelineId: data.pipelineId,
      stageId: data.stageId,
      assigneeId: null,
      source: data.source,
      externalId: data.externalId,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      phone: data.phone,
      company: data.company,
      message: data.message,
      attributes: data.attributes,
      attribution: data.attribution,
      status: data.ticketType === "GREEN" ? "QUALIFIED" : "NURTURING",
      ticketType: data.ticketType,
      intentScore: data.intentScore,
      qualificationReason: data.qualificationReason,
      qualifiedBy: data.qualifiedBy,
      valueCents: data.valueCents,
      respondBy: data.respondBy,
      bookBy: data.bookBy,
      firstResponseAt: null,
      bookedAt: null,
      createdAt: new Date(),
    };
    pushBounded(store().leads, lead);
    return { lead, created: true };
  },

  async listRecentLeads(tenantId, limit = 25) {
    return store().leads.filter((l) => l.tenantId === tenantId).sort(byNewest).slice(0, limit);
  },

  async listNeedsYou(tenantId, { onlyAssigneeId, limit }) {
    return store()
      .leads.filter(
        (l) =>
          l.tenantId === tenantId &&
          l.ticketType === "GREEN" &&
          (l.status === "NEW" || l.status === "QUALIFIED" || l.status === "BOOKING_SENT") &&
          (!onlyAssigneeId || l.assigneeId === onlyAssigneeId || l.assigneeId === null),
      )
      .sort((a, b) => (b.intentScore ?? 0) - (a.intentScore ?? 0) || byNewest(a, b))
      .slice(0, limit);
  },

  async listLeadsPastSla(tenantId, now) {
    const leads = store().leads.filter((l) => l.tenantId === tenantId && l.ticketType === "GREEN");
    return {
      respond: leads.filter((l) => l.respondBy && l.respondBy < now && !l.firstResponseAt && l.status !== "LOST" && l.status !== "ARCHIVED"),
      book: leads.filter((l) => l.bookBy && l.bookBy < now && !l.bookedAt && (l.status === "QUALIFIED" || l.status === "BOOKING_SENT")),
    };
  },

  async markLeadResponded(tenantId, leadId, at) {
    const lead = store().leads.find((l) => l.id === leadId && l.tenantId === tenantId);
    if (lead && !lead.firstResponseAt) lead.firstResponseAt = at;
  },

  async createBooking(tenantId, data: NewBooking) {
    assertLeadInTenant(tenantId, data.leadId);
    const booking = { id: id("bk"), tenantId, ...data };
    pushBounded(store().bookings, booking, false);
    if (data.sent) {
      const lead = store().leads.find((l) => l.id === data.leadId && l.tenantId === tenantId);
      if (lead) lead.status = "BOOKING_SENT";
    }
    return { id: booking.id, bookingUrl: booking.bookingUrl };
  },

  async recordIntakeEvent(tenantId, data) {
    assertLeadInTenant(tenantId, data.leadId);
    assertContactInTenant(tenantId, data.contactId);
    pushBounded(store().intakeEvents, { ...data, id: randomUUID(), tenantId, createdAt: new Date() }, false);
  },

  async upsertMissedOpportunity(tenantId, data: NewMissedOpportunity) {
    assertLeadInTenant(tenantId, data.leadId);
    assertContactInTenant(tenantId, data.contactId);
    const existing = store().missed.find((m) => m.tenantId === tenantId && OPEN_MISSED.has(m.status) && `${m.type}:${m.leadId ?? m.contactId ?? ""}` === data.dedupeKey);
    if (existing) return { record: existing, created: false };
    const record: MissedOpportunityRecord = {
      id: id("mo"),
      tenantId,
      type: data.type,
      status: "DETECTED",
      contactId: data.contactId,
      leadId: data.leadId,
      estimatedValueCents: data.estimatedValueCents,
      recoveredValueCents: 0,
      summary: data.summary,
      detectedAt: new Date(),
      resolvedAt: null,
    };
    pushBounded(store().missed, record);
    return { record, created: true };
  },

  async listMissedOpportunities(tenantId, opts = {}) {
    const statuses = opts.status ? new Set(opts.status) : null;
    return store()
      .missed.filter((m) => m.tenantId === tenantId && (!statuses || statuses.has(m.status)))
      .sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime())
      .slice(0, opts.limit ?? 50);
  },

  async resolveMissedOpportunity(tenantId, moId, status, recoveredValueCents) {
    const m = store().missed.find((x) => x.id === moId && x.tenantId === tenantId);
    if (!m) return null;
    m.status = status;
    if (status === "RECOVERED" || status === "EXPIRED") m.resolvedAt = new Date();
    if (recoveredValueCents !== undefined) m.recoveredValueCents = recoveredValueCents;
    return m;
  },

  async recordAutomationRun(tenantId, data) {
    assertLeadInTenant(tenantId, data.leadId);
    assertContactInTenant(tenantId, data.contactId);
    const run: AutomationRunRecord = {
      id: id("run"),
      tenantId,
      typeKey: data.typeKey,
      outcome: data.outcome,
      summary: data.summary,
      leadId: data.leadId ?? null,
      contactId: data.contactId ?? null,
      missedOpportunityId: data.missedOpportunityId ?? null,
      createdAt: new Date(),
    };
    pushBounded(store().runs, run);
    return run;
  },

  async listAutomationRuns(tenantId, limit = 50) {
    return store().runs.filter((r) => r.tenantId === tenantId).sort(byNewest).slice(0, limit);
  },

  async createException(tenantId, data) {
    assertLeadInTenant(tenantId, data.leadId);
    assertContactInTenant(tenantId, data.contactId);
    const ex: ExceptionRecord = {
      id: id("ex"),
      tenantId,
      reason: data.reason,
      suggestedAction: data.suggestedAction ?? null,
      confidence: data.confidence ?? null,
      status: "OPEN",
      assignedOperatorId: null,
      escalatedToUserId: data.escalatedToUserId ?? null,
      contactId: data.contactId ?? null,
      leadId: data.leadId ?? null,
      missedOpportunityId: data.missedOpportunityId ?? null,
      createdAt: new Date(),
    };
    pushBounded(store().exceptions, ex);
    return ex;
  },

  async listExceptions(tenantIds, opts = {}) {
    const ids = new Set(tenantIds);
    const statuses = new Set(opts.status ?? ["OPEN", "IN_PROGRESS"]);
    return store()
      .exceptions.filter((e) => ids.has(e.tenantId) && statuses.has(e.status))
      .sort(byNewest)
      .slice(0, opts.limit ?? 100);
  },

  async resolveException(tenantId, exId, resolution) {
    const ex = store().exceptions.find((e) => e.id === exId && e.tenantId === tenantId);
    if (!ex) return null;
    ex.status = "RESOLVED";
    void resolution;
    return ex;
  },

  async appendEvent(tenantId, type, payload = {}, causationId = null) {
    const event: DomainEventRecord = { id: id("evt"), tenantId, type, payload, causationId, occurredAt: new Date() };
    pushBounded(store().events, event);
    return event;
  },

  async listEvents(tenantId, limit = 100) {
    return store()
      .events.filter((e) => e.tenantId === tenantId)
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, limit);
  },

  async getWorkbench(tenantId) {
    const s = store();
    return {
      assets: s.assets.filter((a) => a.tenantId === tenantId).sort(byNewest),
      posts: s.posts.filter((p) => p.tenantId === tenantId),
      connectedPlatforms: demoConnectedPlatforms[tenantId] ?? [],
    };
  },

  async createContentAssets(tenantId, items: NewContentAsset[]) {
    const created = items.map((item) => ({
      id: id("asset"),
      tenantId,
      kind: item.kind,
      title: item.title,
      body: item.body,
      targetPlatform: item.targetPlatform,
      status: item.status,
      needsClientSignoff: item.needsClientSignoff,
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

  async listRecentTransactions(tenantId, limit = 25) {
    return store()
      .transactions.filter((t) => t.tenantId === tenantId)
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, limit);
  },

  async getPortalHome(tenantId, opts) {
    const s = store();
    const monthStart = startOfMonthInZone(opts.timezone).getTime();
    const dayStart = startOfDayInZone(opts.timezone).getTime();
    const weekStart = dayStart - 6 * 24 * 60 * 60_000;

    const needsYou = await this.listNeedsYou(tenantId, { onlyAssigneeId: opts.onlyAssigneeId, limit: 8 });
    const open = s.missed.filter((m) => m.tenantId === tenantId && OPEN_MISSED.has(m.status)).sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());
    const recoveredCents = s.missed
      .filter((m) => m.tenantId === tenantId && m.status === "RECOVERED" && (m.resolvedAt?.getTime() ?? 0) >= monthStart)
      .reduce((sum, m) => sum + m.recoveredValueCents, 0);

    const leadsMonth = s.leads.filter((l) => l.tenantId === tenantId && l.createdAt.getTime() >= monthStart).length;
    const revenueMonthCents = s.transactions
      .filter((t) => t.tenantId === tenantId && t.status === "COMPLETED" && t.currency === opts.currency && t.occurredAt.getTime() >= monthStart)
      .reduce((sum, t) => sum + t.amountCents, 0);
    const adSpendMonthCents = demoAdSpendMonthCents[tenantId]?.spentCents ?? 0;

    const runs = s.runs.filter((r) => r.tenantId === tenantId).sort(byNewest);

    return {
      needsYou,
      missed: { open, atRiskCents: open.reduce((sum, m) => sum + m.estimatedValueCents, 0), recoveredCents },
      money: opts.canViewFinances
        ? {
            revenueMonthCents,
            adSpendMonthCents,
            leadsMonth,
            costPerLeadCents: adSpendMonthCents > 0 && leadsMonth > 0 ? Math.round(adSpendMonthCents / leadsMonth) : null,
            currency: opts.currency,
          }
        : null,
      contentAwaiting: s.assets.filter((a) => a.tenantId === tenantId && a.status === "IN_REVIEW").sort(byNewest),
      handled: {
        runs: runs.slice(0, 6),
        countToday: runs.filter((r) => r.createdAt.getTime() >= dayStart).length,
        countWeek: runs.filter((r) => r.createdAt.getTime() >= weekStart).length,
      },
    } satisfies PortalHome;
  },

  async getPortfolio(tenants, now = new Date()) {
    const s = store();
    const rows: PortfolioRow[] = [];
    for (const tenant of tenants) {
      const dayStart = startOfDayInZone(tenant.timezone, now).getTime();
      const { respond, book } = await this.listLeadsPastSla(tenant.id, now);
      const open = s.missed.filter((m) => m.tenantId === tenant.id && OPEN_MISSED.has(m.status));
      const spend = demoAdSpendMonthCents[tenant.id];
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const base = {
        tenant,
        slaBreaches: respond.length + book.length,
        missedOpen: open.length,
        missedAtRiskCents: open.reduce((sum, m) => sum + m.estimatedValueCents, 0),
        exceptionsOpen: s.exceptions.filter((e) => e.tenantId === tenant.id && e.status !== "RESOLVED").length,
        contentDue: s.assets.filter((a) => a.tenantId === tenant.id && a.status === "IN_REVIEW").length,
        adPacing: spend ? { ...spend, daysElapsed: now.getDate(), daysInMonth } : null,
        integrations: s.integrations.filter((i) => i.tenantId === tenant.id).map((i) => ({ provider: i.provider, status: i.status, lastError: i.lastError })),
        leadsToday: s.leads.filter((l) => l.tenantId === tenant.id && l.createdAt.getTime() >= dayStart).length,
      };
      rows.push({ ...base, health: healthScore(base) });
    }
    return rows.sort((a, b) => a.health - b.health);
  },
};
