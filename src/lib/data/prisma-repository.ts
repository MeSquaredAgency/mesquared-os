import type { ContentAsset, Lead, Prisma, SocialPost, Task, Transaction, User } from "@prisma/client";
import { getPrisma } from "@/lib/prisma";
import type {
  ContentAssetRecord,
  LeadRecord,
  QualificationRules,
  SocialPlatform,
  SocialPostRecord,
  TaskRecord,
  TenantBranding,
  TenantSummary,
  TransactionRecord,
  UserRecord,
} from "@/lib/types";
import type { Repository } from "./repository";

const json = (v: unknown) => v as Prisma.InputJsonValue;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function toTenant(t: {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  currency: string;
  branding: unknown;
  qualificationRules: unknown;
}): TenantSummary {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    timezone: t.timezone,
    currency: t.currency,
    branding: obj(t.branding) as TenantBranding,
    qualificationRules: obj(t.qualificationRules) as QualificationRules,
  };
}

type LeadRow = Lead;
type TaskRow = Task;
type TxnRow = Transaction;
type AssetRow = ContentAsset;
type PostRow = SocialPost;

const toLead = (l: LeadRow): LeadRecord => ({
  id: l.id,
  tenantId: l.tenantId,
  source: l.source,
  externalId: l.externalId,
  firstName: l.firstName,
  lastName: l.lastName,
  email: l.email,
  phone: l.phone,
  company: l.company,
  message: l.message,
  attributes: obj(l.attributes),
  status: l.status,
  ticketType: l.ticketType,
  intentScore: l.intentScore,
  qualificationReason: l.qualificationReason,
  qualifiedBy: l.qualifiedBy,
  createdAt: l.createdAt,
});

const toTask = (t: TaskRow): TaskRecord => ({
  id: t.id,
  tenantId: t.tenantId,
  leadId: t.leadId,
  type: t.type,
  title: t.title,
  description: t.description,
  status: t.status,
  priority: t.priority,
  dueAt: t.dueAt,
  automationKey: t.automationKey,
  createdAt: t.createdAt,
});

const toTxn = (t: TxnRow): TransactionRecord => ({
  id: t.id,
  tenantId: t.tenantId,
  leadId: t.leadId,
  squarePaymentId: t.squarePaymentId,
  kind: t.kind,
  status: t.status,
  amountCents: t.amountCents,
  currency: t.currency,
  note: t.note,
  occurredAt: t.occurredAt,
});

const toAsset = (a: AssetRow): ContentAssetRecord => ({
  id: a.id,
  tenantId: a.tenantId,
  kind: a.kind,
  title: a.title,
  body: a.body,
  targetPlatform: a.targetPlatform,
  status: a.status,
  createdAt: a.createdAt,
});

const toPost = (p: PostRow): SocialPostRecord => ({
  id: p.id,
  tenantId: p.tenantId,
  platform: p.platform,
  caption: p.caption,
  tags: p.tags,
  status: p.status,
  scheduledFor: p.scheduledFor,
  batchId: p.batchId,
});

const toUser = (u: User): UserRecord => ({ id: u.id, email: u.email, name: u.name, isPlatformAdmin: u.isPlatformAdmin });

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

/** PostgreSQL-backed repository. Every query is filtered by tenantId. */
export const prismaRepository: Repository = {
  // Each method resolves the client on demand.
  async listTenants() {
    const rows = await getPrisma().tenant.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
    return rows.map(toTenant);
  },

  async listTenantsForUser(userId) {
    const user = await getPrisma().user.findUnique({ where: { id: userId }, select: { isPlatformAdmin: true } });
    if (!user) return [];
    const rows = await getPrisma().tenant.findMany({
      where: user.isPlatformAdmin ? { isActive: true } : { isActive: true, memberships: { some: { userId } } },
      orderBy: { name: "asc" },
    });
    return rows.map(toTenant);
  },

  async findUserById(id) {
    const u = await getPrisma().user.findUnique({ where: { id } });
    return u ? toUser(u) : null;
  },

  async findUserByEmail(email) {
    const u = await getPrisma().user.findUnique({ where: { email: email.toLowerCase() } });
    return u ? { user: toUser(u), passwordHash: u.passwordHash } : null;
  },

  async findTenantByApiKeyHash(hash) {
    const key = await getPrisma().tenantApiKey.findFirst({
      where: { keyHash: hash, revokedAt: null, tenant: { isActive: true } },
      include: { tenant: true },
    });
    if (!key) return null;
    await getPrisma().tenantApiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
    return { tenant: toTenant(key.tenant), apiKeyId: key.id };
  },

  async findDuplicateLead(tenantId, probe) {
    if (probe.externalId) {
      const byExternal = await getPrisma().lead.findUnique({
        where: { tenantId_externalId: { tenantId, externalId: probe.externalId } },
      });
      if (byExternal) return toLead(byExternal);
    }
    const contactFilters: Prisma.LeadWhereInput[] = [];
    if (probe.email) contactFilters.push({ email: probe.email });
    if (probe.phone) contactFilters.push({ phone: probe.phone });
    if (contactFilters.length === 0) return null;
    const recent = await getPrisma().lead.findFirst({
      where: { tenantId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) }, OR: contactFilters },
      orderBy: { createdAt: "desc" },
    });
    return recent ? toLead(recent) : null;
  },

  async createLead(tenantId, data) {
    const row = await getPrisma().lead.create({
      data: {
        tenantId,
        source: data.source,
        externalId: data.externalId,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        phone: data.phone,
        company: data.company,
        message: data.message,
        rawPayload: json(data.rawPayload),
        attributes: json(data.attributes),
        status: data.ticketType === "GREEN" ? "QUALIFIED" : "NURTURING",
        ticketType: data.ticketType,
        intentScore: data.intentScore,
        qualificationReason: data.qualificationReason,
        qualifiedBy: data.qualifiedBy,
        qualifiedAt: new Date(),
      },
    });
    return toLead(row);
  },

  async createTask(tenantId, data) {
    const row = await getPrisma().task.create({
      data: {
        tenantId,
        leadId: data.leadId,
        type: data.type,
        title: data.title,
        description: data.description,
        priority: data.priority,
        dueAt: data.dueAt,
        automationKey: data.automationKey,
      },
    });
    return toTask(row);
  },

  async createBooking(tenantId, data) {
    const [booking] = await getPrisma().$transaction([
      getPrisma().booking.create({ data: { tenantId, leadId: data.leadId, bookingUrl: data.bookingUrl, status: "LINK_SENT" } }),
      getPrisma().lead.update({ where: { id: data.leadId }, data: { status: "BOOKING_SENT" } }),
    ]);
    return { id: booking.id, bookingUrl: data.bookingUrl };
  },

  async recordIntakeEvent(tenantId, data) {
    await getPrisma().intakeEvent.create({
      data: {
        tenantId,
        leadId: data.leadId,
        source: data.source,
        outcome: data.outcome,
        payload: json(data.payload),
        classifier: data.classifier,
      },
    });
  },

  async getTicketBoard(tenantId) {
    const today = startOfToday();
    const openStatuses: Prisma.EnumTaskStatusFilter = { notIn: ["DONE", "CANCELLED"] };
    const [greenTasks, redTasks, greenLeads, redLeads, greenOpen, redOpen, greenLeadsToday, redLeadsToday, bookingsPending, revenue] =
      await getPrisma().$transaction([
        getPrisma().task.findMany({ where: { tenantId, type: "GREEN" }, orderBy: { createdAt: "desc" }, take: 50 }),
        getPrisma().task.findMany({ where: { tenantId, type: "RED" }, orderBy: { createdAt: "desc" }, take: 50 }),
        getPrisma().lead.findMany({ where: { tenantId, ticketType: "GREEN" }, orderBy: { createdAt: "desc" }, take: 50 }),
        getPrisma().lead.findMany({ where: { tenantId, ticketType: "RED" }, orderBy: { createdAt: "desc" }, take: 50 }),
        getPrisma().task.count({ where: { tenantId, type: "GREEN", status: openStatuses } }),
        getPrisma().task.count({ where: { tenantId, type: "RED", status: openStatuses } }),
        getPrisma().lead.count({ where: { tenantId, ticketType: "GREEN", createdAt: { gte: today } } }),
        getPrisma().lead.count({ where: { tenantId, ticketType: "RED", createdAt: { gte: today } } }),
        getPrisma().lead.count({ where: { tenantId, status: "BOOKING_SENT" } }),
        getPrisma().transaction.aggregate({
          where: { tenantId, status: "COMPLETED", occurredAt: { gte: today } },
          _sum: { amountCents: true },
        }),
      ]);
    return {
      stats: {
        greenOpen,
        redOpen,
        greenLeadsToday,
        redLeadsToday,
        bookingsPending,
        revenueTodayCents: revenue._sum.amountCents ?? 0,
      },
      greenTasks: greenTasks.map(toTask),
      redTasks: redTasks.map(toTask),
      greenLeads: greenLeads.map(toLead),
      redLeads: redLeads.map(toLead),
    };
  },

  async listRecentLeads(tenantId, limit = 25) {
    const rows = await getPrisma().lead.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: limit });
    return rows.map(toLead);
  },

  async listRecentTransactions(tenantId, limit = 25) {
    const rows = await getPrisma().transaction.findMany({ where: { tenantId }, orderBy: { occurredAt: "desc" }, take: limit });
    return rows.map(toTxn);
  },

  async getWorkbench(tenantId) {
    const [assets, posts, connections] = await getPrisma().$transaction([
      getPrisma().contentAsset.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 50 }),
      getPrisma().socialPost.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 50 }),
      getPrisma().socialConnection.findMany({ where: { tenantId, isActive: true }, select: { platform: true } }),
    ]);
    return {
      assets: assets.map(toAsset),
      posts: posts.map(toPost),
      connectedPlatforms: Array.from(new Set(connections.map((c) => c.platform as SocialPlatform))),
    };
  },
};
