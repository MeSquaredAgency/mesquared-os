import {
  Prisma,
  type AutomationRun,
  type Booking,
  type Contact,
  type Conversation,
  type FormSession,
  type InformationRequest,
  type Review,
  type ScheduledAction,
  type AdAccount,
  type AdSpendSnapshot,
  type InventoryItem,
  type TenantApiKey,
  type Permission,
  type StageAdvanceTrigger,
  type Channel,
  type ChannelMetricSnapshot,
  type Invoice,
  type SiteMetricSnapshot,
  type TrackedLink,
  type WebEvent,
  type ContentAsset,
  type DomainEvent,
  type Message,
  type ExceptionItem,
  type Integration,
  type Lead,
  type MissedOpportunity,
  type Pipeline,
  type PipelineStage,
  type SocialPost,
  type TenantRole,
  type Transaction,
  type User,
} from "@prisma/client";
import { healthScore } from "@/lib/health";
import { getPrisma } from "@/lib/prisma";
import type {
  AdAccountRecord,
  AdSpendSnapshotRecord,
  OnboardingRecord,
  OnboardingStatus,
  ApiKeyRecord,
  AutomationRunRecord,
  BookingRecord,
  ChannelMetricSnapshotRecord,
  ChannelRecord,
  ContactRecord,
  ContentAssetRecord,
  ConversationRecord,
  DomainEventRecord,
  EscalationRule,
  ExceptionRecord,
  FormSessionRecord,
  InformationRequestRecord,
  IntegrationRecord,
  InventoryItemRecord,
  InvoiceRecord,
  LeadRecord,
  MessageRecord,
  MissedOpportunityRecord,
  OpportunityValues,
  PipelineRecord,
  PortalHome,
  PortfolioRow,
  QualificationRules,
  ReviewRecord,
  ScheduledActionRecord,
  ServiceLevels,
  SiteMetricSnapshotRecord,
  SocialPostRecord,
  TenantAccess,
  TenantBranding,
  TenantPersonRecord,
  TenantRoleRecord,
  TenantSummary,
  TrackedLinkRecord,
  TransactionRecord,
  UserRecord,
  WebEventRecord,
} from "@/lib/types";
import { monthBucketInZone, monthProgressInZone, startOfDayInZone, startOfMonthInZone } from "@/lib/utils";
import { isApiKeyScope, TenantMismatchError, type NewContentAsset, type NewMessage, type Repository } from "./repository";

/** How many tenants the portfolio query works on at once. */
const PORTFOLIO_CONCURRENCY = 5;

const toBooking = (b: Booking): BookingRecord => ({ id: b.id, tenantId: b.tenantId, leadId: b.leadId, provider: b.provider, externalId: b.externalId, bookingUrl: b.bookingUrl, startsAt: b.startsAt, endsAt: b.endsAt, status: b.status, confirmedAt: b.confirmedAt, remindedAt: b.remindedAt, followedUpAt: b.followedUpAt, createdAt: b.createdAt });
const toConversation = (c: Conversation): ConversationRecord => ({ id: c.id, tenantId: c.tenantId, contactId: c.contactId, channel: c.channel, externalId: c.externalId, lastMessageAt: c.lastMessageAt, awaitingReply: c.awaitingReply, platform: c.platform, channelId: c.channelId, meta: obj(c.meta), displayName: c.displayName, suggestedReply: c.suggestedReply });
const toMessage = (m: Message): MessageRecord => ({ id: m.id, tenantId: m.tenantId, conversationId: m.conversationId, direction: m.direction, sender: m.sender, body: m.body, status: m.status, providerMessageId: m.providerMessageId, createdAt: m.createdAt });
const toChannel = (c: Channel): ChannelRecord => ({ id: c.id, tenantId: c.tenantId, integrationId: c.integrationId, platform: c.platform, externalAccountId: c.externalAccountId, displayName: c.displayName, isActive: c.isActive, settings: obj(c.settings) });
const toMetric = (m: ChannelMetricSnapshot): ChannelMetricSnapshotRecord => ({ id: m.id, tenantId: m.tenantId, channelId: m.channelId, platform: m.platform, date: m.date, followers: m.followers, reach: m.reach, impressions: m.impressions, engagements: m.engagements, clicks: m.clicks, posts: m.posts });
const SOURCE_KINDS_DB: ContentAsset["kind"][] = ["RAW_TEXT", "RAW_AUDIO", "RAW_VIDEO", "IMAGE", "TRANSCRIPT"];
const toAction = (a: ScheduledAction): ScheduledActionRecord => ({ id: a.id, tenantId: a.tenantId, typeKey: a.typeKey, action: a.action, runAt: a.runAt, payload: obj(a.payload), dedupeKey: a.dedupeKey, status: a.status, attempts: a.attempts });
const toRequest = (r: InformationRequest): InformationRequestRecord => ({ id: r.id, tenantId: r.tenantId, contactId: r.contactId, leadId: r.leadId, kind: r.kind, description: r.description, dueAt: r.dueAt, status: r.status, chaseCount: r.chaseCount, lastChasedAt: r.lastChasedAt, receivedAt: r.receivedAt, createdAt: r.createdAt });
const toReview = (r: Review): ReviewRecord => ({ id: r.id, tenantId: r.tenantId, provider: r.provider, externalId: r.externalId, authorName: r.authorName, rating: r.rating, body: r.body, url: r.url, receivedAt: r.receivedAt, repliedAt: r.repliedAt });
const toFormSession = (f: FormSession): FormSessionRecord => ({ id: f.id, tenantId: f.tenantId, sessionKey: f.sessionKey, formName: f.formName, pageUrl: f.pageUrl, partial: obj(f.partial), startedAt: f.startedAt, lastSeenAt: f.lastSeenAt, submittedAt: f.submittedAt, convertedLeadId: f.convertedLeadId, flaggedAt: f.flaggedAt });

const json = (v: unknown) => v as Prisma.InputJsonValue;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The token hash stays in the database: the record handed out never carries it. */
function toOnboarding(row: { id: string; label: string; contactEmail: string | null; status: OnboardingStatus; answers: unknown; createdById: string | null; tenantId: string | null; startedAt: Date | null; submittedAt: Date | null; provisionedAt: Date | null; expiresAt: Date; createdAt: Date; updatedAt: Date }): OnboardingRecord {
  return { id: row.id, label: row.label, contactEmail: row.contactEmail, status: row.status, answers: obj(row.answers), createdById: row.createdById, tenantId: row.tenantId, startedAt: row.startedAt, submittedAt: row.submittedAt, provisionedAt: row.provisionedAt, expiresAt: row.expiresAt, createdAt: row.createdAt, updatedAt: row.updatedAt };
}
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Only touch `lastUsedAt` on API keys this often, to avoid a write per request. */
const LAST_USED_THROTTLE_MS = 5 * 60_000;
const DEFAULT_SLA: ServiceLevels = { firstResponseMinutes: 5, bookingWindowHours: 48 };

type TenantRow = Prisma.TenantGetPayload<object>;

function toTenant(t: TenantRow): TenantSummary {
  const sla = obj(t.sla) as Partial<ServiceLevels>;
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    industry: t.industry,
    templateKey: t.templateKey,
    region: t.region,
    timezone: t.timezone,
    locale: t.locale,
    currency: t.currency,
    branding: obj(t.branding) as TenantBranding,
    qualificationRules: obj(t.qualificationRules) as QualificationRules,
    sla: { ...DEFAULT_SLA, ...sla },
    escalationRules: arr(obj(t.escalationRules).rules) as EscalationRule[],
    opportunityValues: obj(t.opportunityValues) as OpportunityValues,
  };
}

const toUser = (u: User): UserRecord => ({ id: u.id, email: u.email, name: u.name, isOperator: u.isOperator || u.isPlatformAdmin, isPlatformAdmin: u.isPlatformAdmin, sessionVersion: u.sessionVersion });
const toRole = (r: TenantRole): TenantRoleRecord => ({ id: r.id, tenantId: r.tenantId, name: r.name, templateKey: r.templateKey, permissions: r.permissions });
const toContact = (c: Contact): ContactRecord => ({ id: c.id, tenantId: c.tenantId, firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone, company: c.company, consent: obj(c.consent) as ContactRecord["consent"], tags: c.tags, lastActivityAt: c.lastActivityAt, lapsedAt: c.lapsedAt, createdAt: c.createdAt });
const toIntegration = (i: Integration): IntegrationRecord => ({ id: i.id, tenantId: i.tenantId, provider: i.provider, label: i.label, status: i.status, externalAccountId: i.externalAccountId, lastSyncAt: i.lastSyncAt, lastError: i.lastError });
const toPipeline = (p: Pipeline & { stages: PipelineStage[] }): PipelineRecord => ({
  id: p.id,
  tenantId: p.tenantId,
  key: p.key,
  name: p.name,
  isDefault: p.isDefault,
  stages: [...p.stages].sort((a, b) => a.order - b.order).map((s) => ({ id: s.id, pipelineId: s.pipelineId, key: s.key, name: s.name, order: s.order, advanceOn: s.advanceOn, isWon: s.isWon, isLost: s.isLost, quietAfterDays: s.quietAfterDays })),
});

const toLead = (l: Lead): LeadRecord => ({
  id: l.id,
  tenantId: l.tenantId,
  contactId: l.contactId,
  pipelineId: l.pipelineId,
  stageId: l.stageId,
  assigneeId: l.assigneeId,
  source: l.source,
  externalId: l.externalId,
  firstName: l.firstName,
  lastName: l.lastName,
  email: l.email,
  phone: l.phone,
  company: l.company,
  message: l.message,
  attributes: obj(l.attributes),
  attribution: obj(l.attribution),
  status: l.status,
  ticketType: l.ticketType,
  intentScore: l.intentScore,
  qualificationReason: l.qualificationReason,
  qualifiedBy: l.qualifiedBy,
  valueCents: l.valueCents,
  respondBy: l.respondBy,
  bookBy: l.bookBy,
  firstResponseAt: l.firstResponseAt,
  bookedAt: l.bookedAt,
  stageEnteredAt: l.stageEnteredAt,
  lastActivityAt: l.lastActivityAt,
  createdAt: l.createdAt,
});

const toMissed = (m: MissedOpportunity): MissedOpportunityRecord => ({ id: m.id, tenantId: m.tenantId, type: m.type, status: m.status, dedupeKey: m.dedupeKey, contactId: m.contactId, leadId: m.leadId, estimatedValueCents: m.estimatedValueCents, recoveredValueCents: m.recoveredValueCents, summary: m.summary, detectedAt: m.detectedAt, resolvedAt: m.resolvedAt });
const toRun = (r: AutomationRun): AutomationRunRecord => ({ id: r.id, tenantId: r.tenantId, typeKey: r.typeKey, outcome: r.outcome, summary: r.summary, leadId: r.leadId, contactId: r.contactId, missedOpportunityId: r.missedOpportunityId, createdAt: r.createdAt });
const toException = (e: ExceptionItem): ExceptionRecord => ({ id: e.id, tenantId: e.tenantId, reason: e.reason, suggestedAction: e.suggestedAction, confidence: e.confidence, status: e.status, assignedOperatorId: e.assignedOperatorId, escalatedToUserId: e.escalatedToUserId, contactId: e.contactId, leadId: e.leadId, missedOpportunityId: e.missedOpportunityId, createdAt: e.createdAt });
const toEvent = (e: DomainEvent): DomainEventRecord => ({ id: e.id, tenantId: e.tenantId, type: e.type, payload: obj(e.payload), causationId: e.causationId, occurredAt: e.occurredAt });
const toAdAccount = (a: AdAccount): AdAccountRecord => ({ id: a.id, tenantId: a.tenantId, platform: a.platform, externalAccountId: a.externalAccountId, name: a.name, currency: a.currency, monthlyBudgetCents: a.monthlyBudgetCents, isActive: a.isActive, lastSyncAt: a.lastSyncAt, lastError: a.lastError, settings: obj(a.settings) });
const toAdSpend = (x: AdSpendSnapshot): AdSpendSnapshotRecord => ({ id: x.id, tenantId: x.tenantId, adAccountId: x.adAccountId, platform: x.platform, date: x.date, campaignId: x.campaignId, campaignName: x.campaignName, spendCents: x.spendCents, impressions: x.impressions, clicks: x.clicks, platformLeads: x.platformLeads });
const toInvoice = (i: Invoice): InvoiceRecord => ({ id: i.id, tenantId: i.tenantId, contactId: i.contactId, provider: i.provider, externalId: i.externalId, number: i.number, amountCents: i.amountCents, amountDueCents: i.amountDueCents, currency: i.currency, status: i.status, issuedAt: i.issuedAt, dueAt: i.dueAt, paidAt: i.paidAt, url: i.url, customerName: i.customerName, customerEmail: i.customerEmail, remindersSent: i.remindersSent, lastReminderAt: i.lastReminderAt });
const toLink = (l: TrackedLink): TrackedLinkRecord => ({ id: l.id, tenantId: l.tenantId, code: l.code, destination: l.destination, label: l.label, source: l.source, medium: l.medium, campaign: l.campaign, content: l.content, clicks: l.clicks, createdAt: l.createdAt });
const toWebEvent = (e: WebEvent): WebEventRecord => ({ id: e.id, tenantId: e.tenantId, kind: e.kind, path: e.path, referrer: e.referrer, source: e.source, sessionKey: e.sessionKey, occurredAt: e.occurredAt });
const toSiteMetrics = (m: SiteMetricSnapshot): SiteMetricSnapshotRecord => ({ id: m.id, tenantId: m.tenantId, date: m.date, sessions: m.sessions, pageviews: m.pageviews, formStarts: m.formStarts, formSubmits: m.formSubmits, linkClicks: m.linkClicks, topPages: obj(m.topPages) as Record<string, number>, topSources: obj(m.topSources) as Record<string, number> });
const utcDay = (d: Date) => new Date(`${d.toISOString().slice(0, 10)}T00:00:00Z`);
const toApiKey = (k: TenantApiKey): ApiKeyRecord => ({ id: k.id, tenantId: k.tenantId, label: k.label, keyPrefix: k.keyPrefix, scopes: k.scopes.filter(isApiKeyScope), lastUsedAt: k.lastUsedAt, revokedAt: k.revokedAt, createdAt: k.createdAt });
const toInventory = (i: InventoryItem): InventoryItemRecord => ({ id: i.id, tenantId: i.tenantId, type: i.type, externalId: i.externalId, name: i.name, status: i.status, quantity: i.quantity, valueCents: i.valueCents, attributes: obj(i.attributes), source: i.source, createdAt: i.createdAt, updatedAt: i.updatedAt });
const toTxn = (t: Transaction): TransactionRecord => ({ id: t.id, tenantId: t.tenantId, contactId: t.contactId, leadId: t.leadId, provider: t.provider, providerId: t.providerId, kind: t.kind, status: t.status, amountCents: t.amountCents, currency: t.currency, note: t.note, occurredAt: t.occurredAt });
const toAsset = (a: ContentAsset): ContentAssetRecord => ({ id: a.id, tenantId: a.tenantId, parentId: a.parentId, kind: a.kind, title: a.title, body: a.body, targetPlatform: a.targetPlatform, status: a.status, needsClientSignoff: a.needsClientSignoff, fileUrl: a.fileUrl, tags: a.tags, scheduledFor: a.scheduledFor, generation: obj(a.generation) as ContentAssetRecord["generation"], rejectionNote: a.rejectionNote, approvedAt: a.approvedAt, createdAt: a.createdAt });
const toPost = (p: SocialPost): SocialPostRecord => ({ id: p.id, tenantId: p.tenantId, channelId: p.channelId, contentAssetId: p.contentAssetId, platform: p.platform, caption: p.caption, mediaUrls: p.mediaUrls, tags: p.tags, status: p.status, scheduledFor: p.scheduledFor, publishedAt: p.publishedAt, externalPostId: p.externalPostId, permalink: p.permalink, errorMessage: p.errorMessage, attempts: p.attempts, metrics: obj(p.metrics) as Record<string, number>, batchId: p.batchId, createdAt: p.createdAt });

/** How far back the SLA detectors and the portfolio look for breaches. */
const SLA_WINDOW_MS = 30 * 86_400_000;

const OPEN_MISSED: MissedOpportunity["status"][] = ["DETECTED", "RECOVERING", "ESCALATED"];

async function assertLeadInTenant(tenantId: string, leadId: string | null | undefined) {
  if (!leadId) return;
  const found = await getPrisma().lead.findFirst({ where: { id: leadId, tenantId }, select: { id: true } });
  if (!found) throw new TenantMismatchError("Lead", leadId);
}

async function assertContactInTenant(tenantId: string, contactId: string | null | undefined) {
  if (!contactId) return;
  const found = await getPrisma().contact.findFirst({ where: { id: contactId, tenantId }, select: { id: true } });
  if (!found) throw new TenantMismatchError("Contact", contactId);
}

/** PostgreSQL-backed repository. Every query is filtered by tenantId. */
export const prismaRepository: Repository = {
  async findUserById(userId) {
    const u = await getPrisma().user.findUnique({ where: { id: userId } });
    return u ? toUser(u) : null;
  },

  async findUserByEmail(email) {
    const u = await getPrisma().user.findUnique({ where: { email: email.toLowerCase() } });
    return u ? { user: toUser(u), passwordHash: u.passwordHash } : null;
  },

  async listTenantAccess(userId) {
    const db = getPrisma();
    const user = await db.user.findUnique({ where: { id: userId }, select: { isPlatformAdmin: true } });
    if (!user) return [];
    if (user.isPlatformAdmin) {
      const rows = await db.tenant.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
      return rows.map((t) => ({ tenant: toTenant(t), via: "admin" as const, roleName: null, permissions: [] }));
    }
    const [assignments, memberships] = await Promise.all([
      db.operatorAssignment.findMany({ where: { userId, tenant: { isActive: true } }, include: { tenant: true } }),
      db.membership.findMany({ where: { userId, tenant: { isActive: true } }, include: { tenant: true, role: true } }),
    ]);
    const access: TenantAccess[] = assignments.map((a) => ({ tenant: toTenant(a.tenant), via: "operator" as const, roleName: null, permissions: [] }));
    for (const m of memberships) {
      if (access.some((x) => x.tenant.id === m.tenantId)) continue;
      access.push({ tenant: toTenant(m.tenant), via: "member", roleName: m.role.name, permissions: m.role.permissions });
    }
    return access.sort((a, b) => a.tenant.name.localeCompare(b.tenant.name));
  },

  async findTenantBySlug(slug) {
    const t = await getPrisma().tenant.findUnique({ where: { slug } });
    return t && t.isActive ? toTenant(t) : null;
  },

  async findTenantById(tenantId) {
    const t = await getPrisma().tenant.findUnique({ where: { id: tenantId } });
    return t && t.isActive ? toTenant(t) : null;
  },

  async listAllTenants() {
    const rows = await getPrisma().tenant.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
    return rows.map(toTenant);
  },

  async findTenantByApiKeyHash(hash) {
    const key = await getPrisma().tenantApiKey.findFirst({ where: { keyHash: hash, revokedAt: null, tenant: { isActive: true } }, include: { tenant: true } });
    if (!key) return null;
    if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
      getPrisma()
        .tenantApiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
        .catch(() => {});
    }
    return { tenant: toTenant(key.tenant), apiKeyId: key.id, scopes: key.scopes.filter(isApiKeyScope) };
  },

  async getTenantConfig(tenantId) {
    const db = getPrisma();
    const [modules, automations, integrations, pipelines, roles, brand] = await Promise.all([
      db.tenantModule.findMany({ where: { tenantId } }),
      db.tenantAutomation.findMany({ where: { tenantId } }),
      db.integration.findMany({ where: { tenantId }, orderBy: { provider: "asc" } }),
      db.pipeline.findMany({ where: { tenantId }, include: { stages: true }, orderBy: { name: "asc" } }),
      db.tenantRole.findMany({ where: { tenantId }, orderBy: { name: "asc" } }),
      db.brandProfile.findUnique({ where: { tenantId } }),
    ]);
    return {
      modules: modules.map((m) => ({ moduleKey: m.moduleKey, enabled: m.enabled, settings: obj(m.settings) })),
      automations: automations.map((a) => ({ typeKey: a.typeKey, enabled: a.enabled, settings: obj(a.settings) })),
      integrations: integrations.map(toIntegration),
      pipelines: pipelines.map(toPipeline),
      roles: roles.map(toRole),
      brand: brand ? { voice: brand.voice, examples: brand.examples, bannedPhrases: brand.bannedPhrases, complianceBlock: obj(brand.complianceBlock) } : null,
    };
  },

  async upsertContact(tenantId, data) {
    const db = getPrisma();
    const filters: Prisma.ContactWhereInput[] = [];
    if (data.email) filters.push({ email: data.email });
    if (data.phone) filters.push({ phone: data.phone });
    const existing = filters.length ? await db.contact.findFirst({ where: { tenantId, OR: filters } }) : null;
    if (existing) {
      // Never attach a new email or phone from an unauthenticated channel to an existing contact.
      const updated = await db.contact.update({
        where: { id: existing.id },
        data: { lastActivityAt: new Date(), lapsedAt: null, firstName: existing.firstName ?? data.firstName, lastName: existing.lastName ?? data.lastName, company: existing.company ?? data.company },
      });
      return toContact(updated);
    }
    const created = await db.contact.create({ data: { tenantId, ...data, lastActivityAt: new Date() } });
    return toContact(created);
  },

  async findDuplicateLead(tenantId, probe) {
    const db = getPrisma();
    if (probe.externalId) {
      const byExternal = await db.lead.findUnique({ where: { tenantId_externalId: { tenantId, externalId: probe.externalId } } });
      if (byExternal) return toLead(byExternal);
    }
    const filters: Prisma.LeadWhereInput[] = [];
    if (probe.email) filters.push({ email: probe.email });
    if (probe.phone) filters.push({ phone: probe.phone });
    if (filters.length === 0) return null;
    const recent = await db.lead.findFirst({ where: { tenantId, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) }, OR: filters }, orderBy: { createdAt: "desc" } });
    return recent ? toLead(recent) : null;
  },

  async createLead(tenantId, data) {
    await assertContactInTenant(tenantId, data.contactId);
    try {
      const row = await getPrisma().lead.create({
        data: {
          tenantId,
          contactId: data.contactId,
          pipelineId: data.pipelineId,
          stageId: data.stageId,
          source: data.source,
          externalId: data.externalId,
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          phone: data.phone,
          company: data.company,
          message: data.message,
          attributes: json(data.attributes),
          attribution: json(data.attribution),
          status: data.ticketType === "GREEN" ? "QUALIFIED" : "NURTURING",
          ticketType: data.ticketType,
          intentScore: data.intentScore,
          qualificationReason: data.qualificationReason,
          qualifiedBy: data.qualifiedBy,
          qualifiedAt: new Date(),
          valueCents: data.valueCents,
          respondBy: data.respondBy,
          bookBy: data.bookBy,
          stageEnteredAt: data.stageId ? new Date() : null,
          lastActivityAt: new Date(),
        },
      });
      return { lead: toLead(row), created: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && data.externalId) {
        const existing = await getPrisma().lead.findUnique({ where: { tenantId_externalId: { tenantId, externalId: data.externalId } } });
        if (existing) return { lead: toLead(existing), created: false };
      }
      throw error;
    }
  },

  async listRecentLeads(tenantId, limit = 25) {
    const rows = await getPrisma().lead.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: limit });
    return rows.map(toLead);
  },

  async listNeedsYou(tenantId, { onlyAssigneeId, limit }) {
    const rows = await getPrisma().lead.findMany({
      where: {
        tenantId,
        ticketType: "GREEN",
        status: { in: ["NEW", "QUALIFIED", "BOOKING_SENT"] },
        ...(onlyAssigneeId ? { OR: [{ assigneeId: onlyAssigneeId }, { assigneeId: null }] } : {}),
      },
      orderBy: [{ intentScore: "desc" }, { createdAt: "desc" }],
      take: limit,
    });
    return rows.map(toLead);
  },

  async listLeadsPastSla(tenantId, now) {
    const db = getPrisma();
    // A breach older than the window has long been raised (or expired) as a missed opportunity; never scan all history.
    const since = new Date(now.getTime() - SLA_WINDOW_MS);
    const [respond, book] = await Promise.all([
      db.lead.findMany({ where: { tenantId, ticketType: "GREEN", respondBy: { lt: now, gte: since }, firstResponseAt: null, status: { notIn: ["LOST", "ARCHIVED"] } }, take: 500 }),
      db.lead.findMany({ where: { tenantId, ticketType: "GREEN", bookBy: { lt: now, gte: since }, bookedAt: null, status: { in: ["QUALIFIED", "BOOKING_SENT"] } }, take: 500 }),
    ]);
    return { respond: respond.map(toLead), book: book.map(toLead) };
  },

  async countLeadsPastSla(tenantId, now) {
    const db = getPrisma();
    const since = new Date(now.getTime() - SLA_WINDOW_MS);
    const [respond, book] = await Promise.all([
      db.lead.count({ where: { tenantId, ticketType: "GREEN", respondBy: { lt: now, gte: since }, firstResponseAt: null, status: { notIn: ["LOST", "ARCHIVED"] } } }),
      db.lead.count({ where: { tenantId, ticketType: "GREEN", bookBy: { lt: now, gte: since }, bookedAt: null, status: { in: ["QUALIFIED", "BOOKING_SENT"] } } }),
    ]);
    return respond + book;
  },

  async findLeadById(tenantId, leadId) {
    const row = await getPrisma().lead.findFirst({ where: { id: leadId, tenantId } });
    return row ? toLead(row) : null;
  },

  async findLeadsByIds(tenantId, leadIds) {
    if (leadIds.length === 0) return [];
    const rows = await getPrisma().lead.findMany({ where: { tenantId, id: { in: [...new Set(leadIds)] } } });
    return rows.map(toLead);
  },

  async settleLeadSla(tenantId, leadId, at, opts = {}) {
    const db = getPrisma();
    await db.lead.updateMany({ where: { id: leadId, tenantId, firstResponseAt: null }, data: { firstResponseAt: at } });
    if (opts.booking) await db.lead.updateMany({ where: { id: leadId, tenantId, bookedAt: null }, data: { bookBy: null } });
  },

  async setLeadStatus(tenantId, leadId, status) {
    await getPrisma().lead.updateMany({ where: { id: leadId, tenantId }, data: { status, lastActivityAt: new Date() } });
  },

  async markLeadBooked(tenantId, leadId, at) {
    const db = getPrisma();
    const lead = await db.lead.findFirst({ where: { id: leadId, tenantId } });
    if (!lead) return null;
    const next = lead.pipelineId ? await db.pipelineStage.findFirst({ where: { pipelineId: lead.pipelineId, advanceOn: "BOOKING_CREATED" }, orderBy: { order: "asc" } }) : null;
    const updated = await db.lead.update({
      where: { id: lead.id },
      data: {
        bookedAt: lead.bookedAt ?? at,
        lastActivityAt: at,
        status: next?.isWon ? "WON" : next?.isLost ? "LOST" : ["NEW", "QUALIFIED", "BOOKING_SENT"].includes(lead.status) ? "BOOKED" : lead.status,
        ...(next?.isWon ? { wonAt: lead.wonAt ?? at } : {}),
        ...(next?.isLost ? { lostAt: lead.lostAt ?? at } : {}),
        ...(next && next.id !== lead.stageId ? { stageId: next.id, stageEnteredAt: at } : {}),
      },
    });
    return toLead(updated);
  },

  async advanceLead(tenantId, leadId, trigger, at) {
    const db = getPrisma();
    const lead = await db.lead.findFirst({ where: { id: leadId, tenantId }, include: { stage: true } });
    if (!lead) return null;
    const next = lead.pipelineId ? await db.pipelineStage.findFirst({ where: { pipelineId: lead.pipelineId, advanceOn: trigger }, orderBy: { order: "asc" } }) : null;
    // Only ever forward: a payment after the "won" stage does not drag the lead back.
    if (!next || next.id === lead.stageId || (lead.stage && next.order <= lead.stage.order)) {
      const touched = await db.lead.update({ where: { id: lead.id }, data: { lastActivityAt: at } });
      return { lead: toLead(touched), moved: false, stageName: lead.stage?.name ?? null };
    }
    const updated = await db.lead.update({
      where: { id: lead.id },
      data: {
        stageId: next.id,
        stageEnteredAt: at,
        lastActivityAt: at,
        ...(next.isWon ? { status: "WON", wonAt: lead.wonAt ?? at } : next.isLost ? { status: "LOST", lostAt: lead.lostAt ?? at } : {}),
      },
    });
    return { lead: toLead(updated), moved: true, stageName: next.name };
  },

  async findLatestOpenLeadForContact(tenantId, contactId) {
    const row = await getPrisma().lead.findFirst({ where: { tenantId, contactId, status: { notIn: ["WON", "LOST", "ARCHIVED"] } }, orderBy: { createdAt: "desc" } });
    return row ? toLead(row) : null;
  },

  async unbookLead(tenantId, leadId, bookBy) {
    await getPrisma().lead.updateMany({ where: { id: leadId, tenantId, status: "BOOKED" }, data: { status: "BOOKING_SENT", bookedAt: null, bookBy, lastActivityAt: new Date() } });
  },

  async assignLead(tenantId, leadId, assigneeId) {
    await getPrisma().lead.updateMany({ where: { id: leadId, tenantId }, data: { assigneeId } });
  },

  async markLeadResponded(tenantId, leadId, at) {
    await getPrisma().lead.updateMany({ where: { id: leadId, tenantId, firstResponseAt: null }, data: { firstResponseAt: at } });
  },

  async createBooking(tenantId, data) {
    await assertLeadInTenant(tenantId, data.leadId);
    const ops: Prisma.PrismaPromise<unknown>[] = [
      getPrisma().booking.create({ data: { tenantId, leadId: data.leadId, bookingUrl: data.bookingUrl, status: data.sent ? "LINK_SENT" : "LINK_PENDING" } }),
    ];
    if (data.sent) ops.push(getPrisma().lead.updateMany({ where: { id: data.leadId, tenantId }, data: { status: "BOOKING_SENT" } }));
    const [booking] = (await getPrisma().$transaction(ops)) as [{ id: string }];
    return { id: booking.id, bookingUrl: data.bookingUrl };
  },

  async recordIntakeEvent(tenantId, data) {
    await assertLeadInTenant(tenantId, data.leadId);
    await assertContactInTenant(tenantId, data.contactId);
    await getPrisma().intakeEvent.create({
      data: { tenantId, channel: data.channel, provider: data.provider, externalId: data.externalId, contactId: data.contactId, leadId: data.leadId, outcome: data.outcome, payload: json(data.payload), classifier: data.classifier },
    });
  },

  async recordMessage(tenantId, data: NewMessage) {
    await assertContactInTenant(tenantId, data.contactId);
    const db = getPrisma();
    const existing = await db.conversation.findFirst({
      where: data.externalConversationId ? { tenantId, channel: data.channel, externalId: data.externalConversationId } : { tenantId, channel: data.channel, contactId: data.contactId ?? "__none__" },
    });
    const convo =
      existing ??
      (await db.conversation.create({ data: { tenantId, contactId: data.contactId, channel: data.channel, externalId: data.externalConversationId ?? null, subject: data.subject ?? null } }));
    const [message] = await db.$transaction([
      db.message.create({
        data: {
          tenantId,
          conversationId: convo.id,
          direction: data.direction,
          sender: data.sender,
          to: data.to ?? null,
          body: data.body,
          status: data.status,
          providerMessageId: data.providerMessageId ?? null,
          automationRunId: data.automationRunId ?? null,
          sentAt: data.direction === "OUTBOUND" && data.status !== "QUEUED" && data.status !== "FAILED" ? new Date() : null,
        },
      }),
      db.conversation.update({ where: { id: convo.id }, data: { lastMessageAt: new Date(), awaitingReply: data.direction === "INBOUND" } }),
      ...(data.contactId && data.direction === "INBOUND" ? [db.contact.updateMany({ where: { id: data.contactId, tenantId }, data: { lastActivityAt: new Date(), lapsedAt: null } })] : []),
    ]);
    return { conversationId: convo.id, messageId: message.id };
  },

  async listAlertRecipients(tenantId) {
    const rows = await getPrisma().membership.findMany({ where: { tenantId, role: { permissions: { has: "RECEIVE_LEAD_ALERTS" } } }, include: { user: true } });
    return rows.map((m) => ({ userId: m.user.id, email: m.user.email, name: m.user.name }));
  },

  async findIntegration(tenantId, provider) {
    const i = await getPrisma().integration.findFirst({ where: { tenantId, provider }, orderBy: { updatedAt: "desc" } });
    return i ? { id: i.id, provider: i.provider, status: i.status, externalAccountId: i.externalAccountId, settings: obj(i.settings), credentialsEnc: i.credentialsEnc } : null;
  },

  async upsertIntegration(tenantId, data) {
    const db = getPrisma();
    const existing = await db.integration.findFirst({ where: { tenantId, provider: data.provider }, orderBy: { updatedAt: "desc" } });
    const patch = {
      ...(data.label !== undefined ? { label: data.label } : {}),
      ...(data.status ? { status: data.status } : {}),
      ...(data.credentialsEnc !== undefined ? { credentialsEnc: data.credentialsEnc } : {}),
      ...(data.lastError !== undefined ? { lastError: data.lastError } : {}),
      ...(data.lastSyncAt !== undefined ? { lastSyncAt: data.lastSyncAt } : {}),
    };
    const row = existing
      ? await db.integration.update({ where: { id: existing.id }, data: { ...patch, externalAccountId: data.externalAccountId || existing.externalAccountId, ...(data.settings ? { settings: json({ ...obj(existing.settings), ...data.settings }) } : {}) } })
      : await db.integration.create({ data: { tenantId, provider: data.provider, externalAccountId: data.externalAccountId, label: data.label ?? null, status: data.status ?? "PENDING", credentialsEnc: data.credentialsEnc ?? null, lastError: data.lastError ?? null, settings: json(data.settings ?? {}) } });
    return { id: row.id, provider: row.provider, status: row.status, externalAccountId: row.externalAccountId, settings: obj(row.settings), credentialsEnc: row.credentialsEnc };
  },

  async findTenantByIntegrationAccount(provider, externalAccountId) {
    const i = await getPrisma().integration.findFirst({ where: { provider, externalAccountId, status: { not: "DISCONNECTED" }, tenant: { isActive: true } }, include: { tenant: true } });
    return i ? toTenant(i.tenant) : null;
  },

  async findTenantByIntegrationId(provider, integrationId) {
    const i = await getPrisma().integration.findFirst({ where: { id: integrationId, provider, tenant: { isActive: true } }, include: { tenant: true } });
    return i ? toTenant(i.tenant) : null;
  },

  async findTenantByChannelAccount(platform, externalAccountId) {
    const c = await getPrisma().channel.findFirst({
      where: { platform, isActive: true, tenant: { isActive: true }, OR: [{ externalAccountId }, { settings: { path: ["igUserId"], equals: externalAccountId } }] },
      include: { tenant: true },
    });
    return c ? toTenant(c.tenant) : null;
  },

  async findBookingById(tenantId, bookingId) {
    const b = await getPrisma().booking.findFirst({ where: { id: bookingId, tenantId } });
    return b ? toBooking(b) : null;
  },

  async findLatestBookingForLead(tenantId, leadId) {
    const b = await getPrisma().booking.findFirst({ where: { tenantId, leadId }, orderBy: { createdAt: "desc" } });
    return b ? toBooking(b) : null;
  },

  async listBookings(tenantId, opts) {
    const rows = await getPrisma().booking.findMany({
      where: {
        tenantId,
        ...(opts.status ? { status: { in: opts.status } } : {}),
        ...(opts.startsBefore || opts.startsAfter ? { startsAt: { ...(opts.startsBefore ? { lt: opts.startsBefore } : {}), ...(opts.startsAfter ? { gt: opts.startsAfter } : {}) } } : {}),
        ...(opts.endsBefore ? { endsAt: { lt: opts.endsBefore } } : {}),
      },
      orderBy: { startsAt: "asc" },
      take: opts.limit ?? 100,
    });
    return rows.map(toBooking);
  },

  async updateBooking(tenantId, bookingId, patch) {
    const { count } = await getPrisma().booking.updateMany({ where: { id: bookingId, tenantId }, data: patch });
    if (count === 0) return null;
    const b = await getPrisma().booking.findUnique({ where: { id: bookingId } });
    return b ? toBooking(b) : null;
  },

  async scheduleAction(tenantId, data) {
    const db = getPrisma();
    const existing = await db.scheduledAction.findUnique({ where: { tenantId_dedupeKey: { tenantId, dedupeKey: data.dedupeKey } } });
    // A key that already ran (DONE/FAILED) or is running stays as it is: the daily and hourly jobs are re-requested
    // by every tick and must not run again. Only a CANCELLED key (a reminder cancelled by a reschedule) is re-armed.
    if (existing && existing.status !== "CANCELLED") return { record: toAction(existing), created: false };
    if (existing) {
      const reset = await db.scheduledAction.update({ where: { id: existing.id }, data: { typeKey: data.typeKey, action: data.action, runAt: data.runAt, payload: json(data.payload ?? {}), status: "PENDING", attempts: 0, lastError: null, ranAt: null } });
      return { record: toAction(reset), created: true };
    }
    // Two ticks can race here (overlapping schedulers, two instances): the loser's insert hits the unique key and
    // we return the row that won. The insert's own result is used, never a re-read, because a read straight after
    // a write can be served stale by a connection pool's query cache.
    try {
      const row = await db.scheduledAction.create({ data: { tenantId, typeKey: data.typeKey, action: data.action, runAt: data.runAt, payload: json(data.payload ?? {}), dedupeKey: data.dedupeKey } });
      return { record: toAction(row), created: true };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const row = await db.scheduledAction.findUnique({ where: { tenantId_dedupeKey: { tenantId, dedupeKey: data.dedupeKey } } });
      if (!row) throw error;
      return { record: toAction(row), created: false };
    }
  },

  async listDueActions(now, limit = 100) {
    const stale = new Date(now.getTime() - 10 * 60_000);
    const rows = await getPrisma().scheduledAction.findMany({ where: { runAt: { lte: now }, OR: [{ status: "PENDING" }, { status: "RUNNING", lockedAt: { lt: stale } }] }, orderBy: { runAt: "asc" }, take: limit });
    return rows.map(toAction);
  },

  async schedulerBacklog(now) {
    const db = getPrisma();
    const dueWhere = { status: "PENDING" as const, runAt: { lte: now } };
    const [due, oldest, failedLast24h] = await Promise.all([
      db.scheduledAction.count({ where: dueWhere }),
      db.scheduledAction.findFirst({ where: dueWhere, orderBy: { runAt: "asc" }, select: { runAt: true } }),
      db.scheduledAction.count({ where: { status: "FAILED", ranAt: { gte: new Date(now.getTime() - 24 * 3_600_000) } } }),
    ]);
    return { due, oldestDueAgeSeconds: oldest ? Math.max(0, Math.round((now.getTime() - oldest.runAt.getTime()) / 1000)) : null, failedLast24h };
  },

  async claimAction(actionId, now, leaseMs) {
    const stale = new Date(now.getTime() - leaseMs);
    const { count } = await getPrisma().scheduledAction.updateMany({
      where: { id: actionId, OR: [{ status: "PENDING" }, { status: "RUNNING", lockedAt: { lt: stale } }] },
      data: { status: "RUNNING", lockedAt: now },
    });
    return count === 1;
  },

  async completeAction(actionId, status, error = null, retryAt) {
    await getPrisma().scheduledAction.update({ where: { id: actionId }, data: { status, lastError: error, ranAt: new Date(), lockedAt: null, attempts: { increment: 1 }, ...(status === "PENDING" && retryAt ? { runAt: retryAt } : {}) } });
  },

  async countOutboundMessages(tenantId, opts) {
    return getPrisma().message.count({ where: { tenantId, direction: "OUTBOUND", status: { not: "FAILED" }, createdAt: { gte: opts.since }, ...(opts.to ? { to: opts.to } : {}) } });
  },

  async cancelActions(tenantId, dedupePrefix) {
    const { count } = await getPrisma().scheduledAction.updateMany({ where: { tenantId, status: "PENDING", dedupeKey: { startsWith: dedupePrefix } }, data: { status: "CANCELLED" } });
    return count;
  },

  async createInformationRequest(tenantId, data) {
    await assertLeadInTenant(tenantId, data.leadId);
    await assertContactInTenant(tenantId, data.contactId);
    const row = await getPrisma().informationRequest.create({ data: { tenantId, ...data } });
    return toRequest(row);
  },

  async findInformationRequestById(tenantId, requestId) {
    const row = await getPrisma().informationRequest.findFirst({ where: { id: requestId, tenantId } });
    return row ? toRequest(row) : null;
  },

  async listInformationRequests(tenantId, opts = {}) {
    const rows = await getPrisma().informationRequest.findMany({ where: { tenantId, status: { in: opts.status ?? ["OPEN", "ESCALATED"] } }, orderBy: { createdAt: "desc" }, take: opts.limit ?? 100 });
    return rows.map(toRequest);
  },

  async updateInformationRequest(tenantId, requestId, patch) {
    const { count } = await getPrisma().informationRequest.updateMany({ where: { id: requestId, tenantId }, data: patch });
    if (count === 0) return null;
    const row = await getPrisma().informationRequest.findUnique({ where: { id: requestId } });
    return row ? toRequest(row) : null;
  },

  async upsertReview(tenantId, data) {
    const db = getPrisma();
    const existing = await db.review.findUnique({ where: { tenantId_provider_externalId: { tenantId, provider: data.provider, externalId: data.externalId } } });
    if (existing) return { record: toReview(existing), created: false };
    const row = await db.review.create({ data: { tenantId, ...data } });
    return { record: toReview(row), created: true };
  },

  async listReviews(tenantId, opts = {}) {
    const rows = await getPrisma().review.findMany({
      where: { tenantId, ...(opts.unansweredOnly ? { repliedAt: null } : {}), ...(opts.receivedBefore ? { receivedAt: { lt: opts.receivedBefore } } : {}) },
      orderBy: { receivedAt: "desc" },
      take: opts.limit ?? 100,
    });
    return rows.map(toReview);
  },

  async markReviewReplied(tenantId, reviewId, replyBody) {
    const { count } = await getPrisma().review.updateMany({ where: { id: reviewId, tenantId }, data: { repliedAt: new Date(), replyBody } });
    if (count === 0) return null;
    const row = await getPrisma().review.findUnique({ where: { id: reviewId } });
    return row ? toReview(row) : null;
  },

  async upsertFormSession(tenantId, data) {
    const db = getPrisma();
    const existing = await db.formSession.findUnique({ where: { tenantId_sessionKey: { tenantId, sessionKey: data.sessionKey } } });
    const row = existing
      ? await db.formSession.update({ where: { id: existing.id }, data: { partial: json({ ...obj(existing.partial), ...data.partial }), lastSeenAt: new Date(), ...(data.formName ? { formName: data.formName } : {}), ...(data.pageUrl ? { pageUrl: data.pageUrl } : {}) } })
      : await db.formSession.create({ data: { tenantId, sessionKey: data.sessionKey, formName: data.formName, pageUrl: data.pageUrl, partial: json(data.partial) } });
    return toFormSession(row);
  },

  async listAbandonedFormSessions(tenantId, idleBefore, limit = 100) {
    // Only sessions that captured a way to reach the person are candidates; filtering in the query means the
    // detail-less ones (which are never flagged) cannot crowd the window and starve detection.
    const rows = await getPrisma().formSession.findMany({
      where: { tenantId, submittedAt: null, flaggedAt: null, lastSeenAt: { lt: idleBefore }, OR: [{ partial: { path: ["email"], string_contains: "@" } }, { partial: { path: ["phone"], string_starts_with: "" } }] },
      orderBy: { lastSeenAt: "asc" },
      take: limit,
    });
    return rows.map(toFormSession).filter((f) => typeof f.partial.email === "string" || typeof f.partial.phone === "string");
  },

  async updateFormSession(tenantId, sessionKey, patch) {
    await getPrisma().formSession.updateMany({ where: { tenantId, sessionKey }, data: patch });
  },

  async listConversationsAwaitingReply(tenantId, opts) {
    const rows = await getPrisma().conversation.findMany({ where: { tenantId, awaitingReply: true, channel: { in: opts.channels }, lastMessageAt: { lt: opts.olderThan } }, orderBy: { lastMessageAt: "asc" }, take: opts.limit ?? 100 });
    return rows.map(toConversation);
  },

  async findContactById(tenantId, contactId) {
    const c = await getPrisma().contact.findFirst({ where: { id: contactId, tenantId } });
    return c ? toContact(c) : null;
  },

  async listLapsedCandidates(tenantId, inactiveBefore, limit = 100) {
    const rows = await getPrisma().contact.findMany({
      where: {
        tenantId,
        lapsedAt: null,
        lastActivityAt: { lt: inactiveBefore },
        OR: [{ leads: { some: { status: "WON" } } }, { transactions: { some: { status: "COMPLETED" } } }, { tags: { has: "customer" } }],
        // Someone who paid or attended inside the window is a current customer, whatever the CRM says.
        NOT: [{ transactions: { some: { status: "COMPLETED", occurredAt: { gte: inactiveBefore } } } }, { leads: { some: { bookings: { some: { status: "COMPLETED", startsAt: { gte: inactiveBefore } } } } } }],
      },
      orderBy: { lastActivityAt: "asc" },
      take: limit,
    });
    return rows.map(toContact);
  },

  async markContactLapsed(tenantId, contactId, at) {
    await getPrisma().contact.updateMany({ where: { id: contactId, tenantId }, data: { lapsedAt: at } });
  },

  async setContactConsent(tenantId, contactId, channel, granted, source) {
    const c = await getPrisma().contact.findFirst({ where: { id: contactId, tenantId } });
    if (!c) return;
    await getPrisma().contact.update({ where: { id: c.id }, data: { consent: json({ ...obj(c.consent), [channel]: { granted, at: new Date().toISOString(), source } }) } });
  },

  async listLeadsQuietInStage(tenantId, now) {
    // Only leads that have sat in a quiet-watched stage for at least a day can qualify; the rest never leave the database.
    const rows = await getPrisma().lead.findMany({
      where: { tenantId, stage: { quietAfterDays: { not: null } }, status: { notIn: ["WON", "LOST", "ARCHIVED"] }, OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: new Date(now.getTime() - 86_400_000) } }] },
      include: { stage: true },
      orderBy: { lastActivityAt: { sort: "asc", nulls: "first" } },
      take: 500,
    });
    const out: { lead: LeadRecord; stageName: string; quietDays: number }[] = [];
    for (const row of rows) {
      const days = row.stage?.quietAfterDays ?? null;
      if (!days) continue;
      const since = Math.max(row.stageEnteredAt?.getTime() ?? 0, row.lastActivityAt?.getTime() ?? 0, row.createdAt.getTime());
      const quietDays = (now.getTime() - since) / 86_400_000;
      if (quietDays >= days) out.push({ lead: toLead(row), stageName: row.stage!.name, quietDays: Math.floor(quietDays) });
    }
    return out;
  },

  async touchLead(tenantId, leadId, at) {
    await getPrisma().lead.updateMany({ where: { id: leadId, tenantId }, data: { lastActivityAt: at } });
  },

  async upsertMissedOpportunity(tenantId, data) {
    await assertLeadInTenant(tenantId, data.leadId);
    await assertContactInTenant(tenantId, data.contactId);
    const db = getPrisma();
    const existing = await db.missedOpportunity.findUnique({ where: { tenantId_dedupeKey: { tenantId, dedupeKey: data.dedupeKey } } });
    if (existing && OPEN_MISSED.includes(existing.status)) return { record: toMissed(existing), created: false };
    if (existing) {
      // Recently closed by a person: leave it closed.
      if ((existing.resolvedAt ?? existing.detectedAt).getTime() > Date.now() - 7 * 86_400_000) return { record: toMissed(existing), created: false };
      // Older: reopen rather than violate the unique key.
      const reopened = await db.missedOpportunity.update({ where: { id: existing.id }, data: { status: "DETECTED", summary: data.summary, estimatedValueCents: data.estimatedValueCents, detectedAt: new Date(), resolvedAt: null } });
      return { record: toMissed(reopened), created: true };
    }
    try {
      const created = await db.missedOpportunity.create({
        data: { tenantId, type: data.type, contactId: data.contactId, leadId: data.leadId, estimatedValueCents: data.estimatedValueCents, summary: data.summary, dedupeKey: data.dedupeKey },
      });
      return { record: toMissed(created), created: true };
    } catch (error) {
      // Two overlapping ticks raced on the same subject: the other one won, and this is the same item, not a failure.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const winner = await db.missedOpportunity.findUnique({ where: { tenantId_dedupeKey: { tenantId, dedupeKey: data.dedupeKey } } });
      if (!winner) throw error;
      return { record: toMissed(winner), created: false };
    }
  },

  async listMissedOpportunities(tenantId, opts = {}) {
    const rows = await getPrisma().missedOpportunity.findMany({ where: { tenantId, ...(opts.status ? { status: { in: opts.status } } : {}), ...(opts.onlyAssigneeId ? { lead: { assigneeId: opts.onlyAssigneeId } } : {}) }, orderBy: { detectedAt: "desc" }, take: opts.limit ?? 50 });
    return rows.map(toMissed);
  },

  async findMissedOpportunityById(tenantId, id) {
    const row = await getPrisma().missedOpportunity.findFirst({ where: { id, tenantId } });
    return row ? toMissed(row) : null;
  },

  async listOpenMissedOpportunitiesBefore(tenantId, before, limit = 200) {
    const rows = await getPrisma().missedOpportunity.findMany({ where: { tenantId, status: { in: OPEN_MISSED }, detectedAt: { lt: before } }, orderBy: { detectedAt: "asc" }, take: limit });
    return rows.map(toMissed);
  },

  async listOpenMissedOpportunitiesFor(tenantId, subject) {
    const by: Prisma.MissedOpportunityWhereInput[] = [];
    if (subject.leadId) by.push({ leadId: subject.leadId });
    if (subject.contactId) by.push({ contactId: subject.contactId });
    if (by.length === 0) return [];
    const rows = await getPrisma().missedOpportunity.findMany({
      where: { tenantId, status: { in: OPEN_MISSED }, OR: by, ...(subject.types?.length ? { type: { in: subject.types } } : {}) },
      orderBy: { detectedAt: "asc" },
      take: 100,
    });
    return rows.map(toMissed);
  },

  async resolveMissedOpportunity(tenantId, moId, status, recoveredValueCents) {
    const { count } = await getPrisma().missedOpportunity.updateMany({
      where: { id: moId, tenantId },
      data: { status, resolvedAt: status === "RECOVERED" || status === "EXPIRED" ? new Date() : null, ...(recoveredValueCents !== undefined ? { recoveredValueCents } : {}) },
    });
    if (count === 0) return null;
    if (status === "RECOVERED" || status === "EXPIRED") {
      await getPrisma().exceptionItem.updateMany({ where: { tenantId, missedOpportunityId: moId, status: { in: ["OPEN", "IN_PROGRESS"] } }, data: { status: "RESOLVED", resolution: status === "RECOVERED" ? "Recovered" : "No longer relevant", resolvedAt: new Date() } });
    }
    const row = await getPrisma().missedOpportunity.findUnique({ where: { id: moId } });
    return row ? toMissed(row) : null;
  },

  async resolveMissedOpportunityByKey(tenantId, dedupeKey, status, recoveredValueCents) {
    const row = await getPrisma().missedOpportunity.findFirst({ where: { tenantId, dedupeKey, status: { in: OPEN_MISSED } } });
    return row ? this.resolveMissedOpportunity(tenantId, row.id, status, recoveredValueCents ?? (status === "RECOVERED" ? row.estimatedValueCents : 0)) : null;
  },

  async recordAutomationRun(tenantId, data) {
    await assertLeadInTenant(tenantId, data.leadId);
    await assertContactInTenant(tenantId, data.contactId);
    const row = await getPrisma().automationRun.create({
      data: { tenantId, typeKey: data.typeKey, outcome: data.outcome, summary: data.summary, details: json(data.details ?? {}), contactId: data.contactId ?? null, leadId: data.leadId ?? null, missedOpportunityId: data.missedOpportunityId ?? null },
    });
    return toRun(row);
  },

  async updateAutomationRun(tenantId, runId, patch) {
    await getPrisma().automationRun.updateMany({ where: { id: runId, tenantId }, data: { outcome: patch.outcome, summary: patch.summary, ...(patch.details ? { details: json(patch.details) } : {}) } });
  },

  async countAutomationRuns(tenantId, opts) {
    return getPrisma().automationRun.count({ where: { tenantId, typeKey: opts.typeKey, ...(opts.contactId ? { contactId: opts.contactId } : {}), ...(opts.leadId ? { leadId: opts.leadId } : {}), ...(opts.outcome ? { outcome: opts.outcome } : {}), ...(opts.since ? { createdAt: { gte: opts.since } } : {}) } });
  },

  async countLeadsByAssignee(tenantId, since) {
    const groups = await getPrisma().lead.groupBy({ by: ["assigneeId"], where: { tenantId, createdAt: { gte: since }, assigneeId: { not: null } }, _count: { _all: true } });
    return Object.fromEntries(groups.filter((g) => g.assigneeId).map((g) => [g.assigneeId as string, g._count._all]));
  },

  async listAutomationRuns(tenantId, limit = 50, opts = {}) {
    const rows = await getPrisma().automationRun.findMany({ where: { tenantId, ...(opts.onlyAssigneeId ? { lead: { assigneeId: opts.onlyAssigneeId } } : {}) }, orderBy: { createdAt: "desc" }, take: limit });
    return rows.map(toRun);
  },

  async createException(tenantId, data) {
    await assertLeadInTenant(tenantId, data.leadId);
    await assertContactInTenant(tenantId, data.contactId);
    if (data.missedOpportunityId) {
      const prior = await getPrisma().exceptionItem.findUnique({ where: { missedOpportunityId: data.missedOpportunityId } });
      if (prior && prior.tenantId === tenantId) {
        const reopened = await getPrisma().exceptionItem.update({ where: { id: prior.id }, data: { reason: data.reason, suggestedAction: data.suggestedAction ?? null, confidence: data.confidence ?? null, status: "OPEN", resolvedAt: null, resolution: null, escalatedToUserId: data.escalatedToUserId ?? prior.escalatedToUserId, createdAt: new Date() } });
        return toException(reopened);
      }
    }
    const row = await getPrisma().exceptionItem.create({
      data: { tenantId, reason: data.reason, suggestedAction: data.suggestedAction ?? null, confidence: data.confidence ?? null, contactId: data.contactId ?? null, leadId: data.leadId ?? null, missedOpportunityId: data.missedOpportunityId ?? null, escalatedToUserId: data.escalatedToUserId ?? null },
    });
    return toException(row);
  },

  async listExceptions(tenantIds, opts = {}) {
    const rows = await getPrisma().exceptionItem.findMany({ where: { tenantId: { in: tenantIds }, status: { in: opts.status ?? ["OPEN", "IN_PROGRESS"] } }, orderBy: { createdAt: "desc" }, take: opts.limit ?? 100 });
    return rows.map(toException);
  },

  async resolveException(tenantId, exId, resolution) {
    const { count } = await getPrisma().exceptionItem.updateMany({ where: { id: exId, tenantId, status: { in: ["OPEN", "IN_PROGRESS"] } }, data: { status: "RESOLVED", resolution, resolvedAt: new Date() } });
    if (count === 0) return null;
    const row = await getPrisma().exceptionItem.findUnique({ where: { id: exId } });
    return row ? toException(row) : null;
  },

  async appendEvent(tenantId, type, payload = {}, causationId = null) {
    const row = await getPrisma().domainEvent.create({ data: { tenantId, type, payload: json(payload), causationId } });
    return toEvent(row);
  },

  async listEvents(tenantId, limit = 100) {
    const rows = await getPrisma().domainEvent.findMany({ where: { tenantId }, orderBy: { occurredAt: "desc" }, take: limit });
    return rows.map(toEvent);
  },

  async getWorkbench(tenantId) {
    const db = getPrisma();
    const [assets, sources, posts, channels] = await Promise.all([
      db.contentAsset.findMany({ where: { tenantId, kind: { notIn: SOURCE_KINDS_DB } }, orderBy: { createdAt: "desc" }, take: 100 }),
      db.contentAsset.findMany({ where: { tenantId, kind: { in: SOURCE_KINDS_DB } }, orderBy: { createdAt: "desc" }, take: 50 }),
      db.socialPost.findMany({ where: { tenantId }, orderBy: [{ scheduledFor: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }], take: 100 }),
      db.channel.findMany({ where: { tenantId, isActive: true } }),
    ]);
    const ch = channels.map(toChannel);
    return { assets: assets.map(toAsset), sources: sources.map(toAsset), posts: posts.map(toPost), channels: ch, connectedPlatforms: Array.from(new Set(ch.map((c) => c.platform))) };
  },

  async createContentAssets(tenantId, items: NewContentAsset[]) {
    const rows = await getPrisma().$transaction(
      items.map((item) =>
        getPrisma().contentAsset.create({
          data: {
            tenantId,
            kind: item.kind as ContentAsset["kind"],
            title: item.title,
            body: item.body,
            targetPlatform: item.targetPlatform,
            status: item.status,
            needsClientSignoff: item.needsClientSignoff,
            fileUrl: item.fileUrl ?? null,
            parentId: item.parentId ?? null,
            tags: item.tags ?? [],
            scheduledFor: item.scheduledFor ?? null,
            generation: json(item.generation ?? {}),
          },
        }),
      ),
    );
    return rows.map(toAsset);
  },

  async findContentAssetById(tenantId, assetId) {
    const row = await getPrisma().contentAsset.findFirst({ where: { id: assetId, tenantId } });
    return row ? toAsset(row) : null;
  },

  async listContentAssets(tenantId, opts = {}) {
    const rows = await getPrisma().contentAsset.findMany({
      where: { tenantId, ...(opts.status ? { status: { in: opts.status } } : {}), ...(opts.kinds ? { kind: { in: opts.kinds as ContentAsset["kind"][] } } : {}), ...(opts.parentId !== undefined ? { parentId: opts.parentId } : {}) },
      orderBy: { createdAt: "desc" },
      take: opts.limit ?? 100,
    });
    return rows.map(toAsset);
  },

  async updateContentAsset(tenantId, assetId, patch) {
    const { generation, ...rest } = patch;
    const { count } = await getPrisma().contentAsset.updateMany({ where: { id: assetId, tenantId }, data: { ...rest, ...(generation ? { generation: json(generation) } : {}), ...(patch.status === "APPROVED" ? { approvedAt: new Date() } : {}) } });
    if (count === 0) return null;
    const row = await getPrisma().contentAsset.findUnique({ where: { id: assetId } });
    return row ? toAsset(row) : null;
  },

  // --- social --------------------------------------------------------------------

  async listChannels(tenantId, opts = {}) {
    const rows = await getPrisma().channel.findMany({ where: { tenantId, ...(opts.activeOnly ? { isActive: true } : {}) }, orderBy: { createdAt: "asc" } });
    return rows.map(toChannel);
  },

  async upsertChannel(tenantId, data) {
    const db = getPrisma();
    const existing = await db.channel.findUnique({ where: { tenantId_platform_externalAccountId: { tenantId, platform: data.platform, externalAccountId: data.externalAccountId } } });
    const row = existing
      ? await db.channel.update({ where: { id: existing.id }, data: { displayName: data.displayName ?? existing.displayName, integrationId: data.integrationId ?? existing.integrationId, isActive: data.isActive ?? existing.isActive, settings: json({ ...obj(existing.settings), ...(data.settings ?? {}) }) } })
      : await db.channel.create({ data: { tenantId, platform: data.platform, externalAccountId: data.externalAccountId, displayName: data.displayName ?? null, integrationId: data.integrationId ?? null, isActive: data.isActive ?? true, settings: json(data.settings ?? {}) } });
    return toChannel(row);
  },

  async createSocialPosts(tenantId, items) {
    const db = getPrisma();
    const rows = await db.$transaction(items.map((p) => db.socialPost.create({ data: { tenantId, channelId: p.channelId, contentAssetId: p.contentAssetId, platform: p.platform, caption: p.caption, mediaUrls: p.mediaUrls ?? [], tags: p.tags ?? [], status: p.status, scheduledFor: p.scheduledFor, batchId: p.batchId ?? null } })));
    return rows.map(toPost);
  },

  async listSocialPosts(tenantId, opts = {}) {
    const rows = await getPrisma().socialPost.findMany({
      where: { tenantId, ...(opts.status ? { status: { in: opts.status } } : {}), ...(opts.from || opts.to ? { scheduledFor: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lt: opts.to } : {}) } } : {}) },
      orderBy: { scheduledFor: { sort: "asc", nulls: "last" } },
      take: opts.limit ?? 200,
    });
    return rows.map(toPost);
  },

  async listSocialPostsForAsset(tenantId, contentAssetId) {
    const rows = await getPrisma().socialPost.findMany({ where: { tenantId, contentAssetId }, orderBy: { createdAt: "asc" }, take: 50 });
    return rows.map(toPost);
  },

  async findSocialPostById(tenantId, postId) {
    const row = await getPrisma().socialPost.findFirst({ where: { id: postId, tenantId } });
    return row ? toPost(row) : null;
  },

  async updateSocialPost(tenantId, postId, patch) {
    const { metrics, ...rest } = patch;
    const { count } = await getPrisma().socialPost.updateMany({ where: { id: postId, tenantId }, data: { ...rest, ...(metrics ? { metrics: json(metrics) } : {}), ...(patch.status && patch.status !== "PUBLISHING" ? { lockedAt: null } : {}) } });
    if (count === 0) return null;
    const row = await getPrisma().socialPost.findUnique({ where: { id: postId } });
    return row ? toPost(row) : null;
  },

  async listDueSocialPosts(now, limit = 50) {
    const stale = new Date(now.getTime() - 10 * 60_000);
    const rows = await getPrisma().socialPost.findMany({ where: { scheduledFor: { lte: now }, OR: [{ status: "SCHEDULED" }, { status: "PUBLISHING", lockedAt: { lt: stale } }] }, orderBy: { scheduledFor: "asc" }, take: limit });
    return rows.map(toPost);
  },

  async claimSocialPost(postId, now, leaseMs) {
    const stale = new Date(now.getTime() - leaseMs);
    const { count } = await getPrisma().socialPost.updateMany({ where: { id: postId, OR: [{ status: "SCHEDULED" }, { status: "PUBLISHING", lockedAt: { lt: stale } }] }, data: { status: "PUBLISHING", lockedAt: now } });
    return count === 1;
  },

  async recordChannelMetrics(tenantId, data) {
    const date = new Date(`${data.date.toISOString().slice(0, 10)}T00:00:00Z`);
    const values = { followers: data.followers ?? null, reach: data.reach ?? null, impressions: data.impressions ?? null, engagements: data.engagements ?? null, clicks: data.clicks ?? null, posts: data.posts ?? null, raw: json(data.raw ?? {}) };
    await getPrisma().channelMetricSnapshot.upsert({ where: { channelId_date: { channelId: data.channelId, date } }, create: { tenantId, channelId: data.channelId, platform: data.platform, date, ...values }, update: values });
  },

  async listChannelMetrics(tenantId, opts) {
    const rows = await getPrisma().channelMetricSnapshot.findMany({ where: { tenantId, date: { gte: opts.since }, ...(opts.channelId ? { channelId: opts.channelId } : {}) }, orderBy: { date: "asc" } });
    return rows.map(toMetric);
  },

  async upsertSocialConversation(tenantId, data) {
    const db = getPrisma();
    const existing = await db.conversation.findUnique({ where: { tenantId_channel_externalId: { tenantId, channel: data.channel, externalId: data.externalId } } });
    if (existing) return { record: toConversation(existing), created: false };
    const row = await db.conversation.create({ data: { tenantId, contactId: data.contactId ?? null, channel: data.channel, externalId: data.externalId, platform: data.platform, channelId: data.channelId, meta: json(data.meta ?? {}), displayName: data.displayName } });
    return { record: toConversation(row), created: true };
  },

  async listInboxConversations(tenantId, opts = {}) {
    const rows = await getPrisma().conversation.findMany({ where: { tenantId, channel: { in: ["SOCIAL_DM", "SOCIAL_COMMENT"] }, ...(opts.awaitingOnly ? { awaitingReply: true } : {}) }, orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } }, take: opts.limit ?? 100 });
    return rows.map(toConversation);
  },

  async findConversationById(tenantId, conversationId) {
    const row = await getPrisma().conversation.findFirst({ where: { id: conversationId, tenantId } });
    return row ? toConversation(row) : null;
  },

  async listMessages(tenantId, conversationId, limit = 50) {
    const rows = await getPrisma().message.findMany({ where: { tenantId, conversationId }, orderBy: { createdAt: "desc" }, take: limit });
    return rows.reverse().map(toMessage);
  },

  async hasMessageWithProviderId(tenantId, conversationId, providerMessageId) {
    return (await getPrisma().message.count({ where: { tenantId, conversationId, providerMessageId } })) > 0;
  },

  async updateConversation(tenantId, conversationId, patch) {
    const db = getPrisma();
    const existing = patch.meta ? await db.conversation.findFirst({ where: { id: conversationId, tenantId } }) : null;
    await db.conversation.updateMany({ where: { id: conversationId, tenantId }, data: { ...(patch.awaitingReply !== undefined ? { awaitingReply: patch.awaitingReply } : {}), ...(patch.suggestedReply !== undefined ? { suggestedReply: patch.suggestedReply } : {}), ...(patch.meta ? { meta: json({ ...(existing ? obj(existing.meta) : {}), ...patch.meta }) } : {}) } });
  },

  async updateContentAssetStatus(tenantId, assetId, status, note) {
    const { count } = await getPrisma().contentAsset.updateMany({
      where: { id: assetId, tenantId },
      data: { status, rejectionNote: status === "REJECTED" ? (note ?? null) : null, approvedAt: status === "APPROVED" ? new Date() : null },
    });
    if (count === 0) return null;
    const row = await getPrisma().contentAsset.findUnique({ where: { id: assetId } });
    return row ? toAsset(row) : null;
  },

  async listRecentTransactions(tenantId, limit = 25) {
    const rows = await getPrisma().transaction.findMany({ where: { tenantId }, orderBy: { occurredAt: "desc" }, take: limit });
    return rows.map(toTxn);
  },

  // --- provisioning, people, keys, inventory (Phase 5) ------------------------------

  async createTenant(data) {
    const db = getPrisma();
    if (await db.tenant.findUnique({ where: { slug: data.slug } })) throw new Error("That workspace address is already taken.");
    const row = await db.tenant.create({ data: { slug: data.slug, name: data.name, industry: data.industry, templateKey: data.templateKey, region: data.region, timezone: data.timezone, locale: data.locale, currency: data.currency, branding: json(data.branding ?? {}), qualificationRules: json(data.qualificationRules ?? {}), sla: json(data.sla ?? { firstResponseMinutes: 5, bookingWindowHours: 48 }), opportunityValues: json(data.opportunityValues ?? {}), settings: json(data.settings ?? {}) } });
    return toTenant(row);
  },

  async updateTenant(tenantId, patch) {
    const db = getPrisma();
    const existing = await db.tenant.findUnique({ where: { id: tenantId } });
    if (!existing) return null;
    const row = await db.tenant.update({
      where: { id: tenantId },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.region !== undefined ? { region: patch.region } : {}),
        ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
        ...(patch.locale !== undefined ? { locale: patch.locale } : {}),
        ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
        ...(patch.branding !== undefined ? { branding: json(patch.branding) } : {}),
        ...(patch.qualificationRules !== undefined ? { qualificationRules: json(patch.qualificationRules) } : {}),
        ...(patch.sla !== undefined ? { sla: json(patch.sla) } : {}),
        ...(patch.escalationRules !== undefined ? { escalationRules: json({ rules: patch.escalationRules }) } : {}),
        ...(patch.opportunityValues !== undefined ? { opportunityValues: json(patch.opportunityValues) } : {}),
        ...(patch.settings !== undefined ? { settings: json({ ...obj(existing.settings), ...patch.settings }) } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      },
    });
    return toTenant(row);
  },

  async applyTemplate(tenantId, template) {
    // Everything or nothing: a failure part way must not leave roles without pipelines or modules.
    await getPrisma().$transaction(async (tx) => {
      for (const role of template.roles) {
        await tx.tenantRole.upsert({ where: { tenantId_name: { tenantId, name: role.name } }, update: { permissions: role.permissions as Permission[], templateKey: role.key }, create: { tenantId, name: role.name, templateKey: role.key, permissions: role.permissions as Permission[] } });
      }
      for (const p of template.pipelines) {
        const pipeline = await tx.pipeline.upsert({ where: { tenantId_key: { tenantId, key: p.key } }, update: { name: p.name, isDefault: Boolean(p.isDefault) }, create: { tenantId, key: p.key, name: p.name, isDefault: Boolean(p.isDefault) } });
        for (const [order, st] of p.stages.entries()) {
          const data = { name: st.name, order, advanceOn: (st.advanceOn ?? "MANUAL") as StageAdvanceTrigger, isWon: Boolean(st.isWon), isLost: Boolean(st.isLost), quietAfterDays: st.quietAfterDays ?? null };
          await tx.pipelineStage.upsert({ where: { pipelineId_key: { pipelineId: pipeline.id, key: st.key } }, update: data, create: { tenantId, pipelineId: pipeline.id, key: st.key, ...data } });
        }
      }
      const { MODULES } = await import("@/lib/modules/registry");
      const { AUTOMATIONS } = await import("@/lib/automations/registry");
      const enabledModules = new Map(template.modules.map((m) => [m.key, m.settings ?? {}]));
      for (const m of MODULES) {
        const settings = json(enabledModules.get(m.key) ?? {});
        await tx.tenantModule.upsert({ where: { tenantId_moduleKey: { tenantId, moduleKey: m.key } }, update: { enabled: enabledModules.has(m.key), settings }, create: { tenantId, moduleKey: m.key, enabled: enabledModules.has(m.key), settings } });
      }
      const enabledAutomations = new Map(template.automations.map((a) => [a.key, a.settings ?? {}]));
      for (const a of AUTOMATIONS) {
        const settings = json(enabledAutomations.get(a.key) ?? {});
        await tx.tenantAutomation.upsert({ where: { tenantId_typeKey: { tenantId, typeKey: a.key } }, update: { enabled: enabledAutomations.has(a.key), settings }, create: { tenantId, typeKey: a.key, enabled: enabledAutomations.has(a.key), settings } });
      }
      const existingBrand = await tx.brandProfile.findUnique({ where: { tenantId } });
      const footer = (obj(existingBrand?.complianceBlock ?? {}) as { requiredFooter?: string }).requiredFooter;
      const complianceBlock = { ...template.brand.complianceBlock, ...(footer ? { requiredFooter: footer } : {}) };
      await tx.brandProfile.upsert({ where: { tenantId }, update: { voice: template.brand.voice, bannedPhrases: template.brand.bannedPhrases, complianceBlock: json(complianceBlock) }, create: { tenantId, voice: template.brand.voice, bannedPhrases: template.brand.bannedPhrases, complianceBlock: json(complianceBlock) } });
      await tx.tenant.update({ where: { id: tenantId }, data: { templateKey: template.key, industry: template.industry } });
    });
  },

  async setModule(tenantId, moduleKey, patch) {
    const db = getPrisma();
    const existing = await db.tenantModule.findUnique({ where: { tenantId_moduleKey: { tenantId, moduleKey } } });
    const settings = json({ ...(existing ? obj(existing.settings) : {}), ...(patch.settings ?? {}) });
    await db.tenantModule.upsert({ where: { tenantId_moduleKey: { tenantId, moduleKey } }, update: { ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}), settings }, create: { tenantId, moduleKey, enabled: patch.enabled ?? false, settings } });
  },

  async setAutomation(tenantId, typeKey, patch) {
    const db = getPrisma();
    const existing = await db.tenantAutomation.findUnique({ where: { tenantId_typeKey: { tenantId, typeKey } } });
    const settings = json({ ...(existing ? obj(existing.settings) : {}), ...(patch.settings ?? {}) });
    await db.tenantAutomation.upsert({ where: { tenantId_typeKey: { tenantId, typeKey } }, update: { ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}), settings }, create: { tenantId, typeKey, enabled: patch.enabled ?? false, settings } });
  },

  async updateBrandProfile(tenantId, patch) {
    const db = getPrisma();
    const existing = await db.brandProfile.findUnique({ where: { tenantId } });
    const complianceBlock = json({ ...(existing ? obj(existing.complianceBlock) : {}), ...(patch.complianceBlock ?? {}) });
    await db.brandProfile.upsert({
      where: { tenantId },
      update: { ...(patch.voice !== undefined ? { voice: patch.voice } : {}), ...(patch.examples !== undefined ? { examples: patch.examples } : {}), ...(patch.bannedPhrases !== undefined ? { bannedPhrases: patch.bannedPhrases } : {}), complianceBlock },
      create: { tenantId, voice: patch.voice ?? null, examples: patch.examples ?? [], bannedPhrases: patch.bannedPhrases ?? [], complianceBlock },
    });
  },

  async listTenantPeople(tenantId) {
    const db = getPrisma();
    const [members, operators] = await Promise.all([db.membership.findMany({ where: { tenantId }, include: { user: true, role: true } }), db.operatorAssignment.findMany({ where: { tenantId }, include: { user: true } })]);
    return [
      ...members.map((m): TenantPersonRecord => ({ userId: m.userId, email: m.user.email, name: m.user.name, via: "member", roleId: m.roleId, roleName: m.role.name, permissions: m.role.permissions, title: m.title, phone: m.phone, photoUrl: m.photoUrl })),
      ...operators.map((o): TenantPersonRecord => ({ userId: o.userId, email: o.user.email, name: o.user.name, via: "operator", roleId: null, roleName: null, permissions: [], title: null, phone: null, photoUrl: null })),
    ];
  },

  async setUserFlags(userId, flags) {
    await getPrisma().user.update({ where: { id: userId }, data: { ...(flags.isOperator !== undefined ? { isOperator: flags.isOperator } : {}), ...(flags.isPlatformAdmin !== undefined ? { isPlatformAdmin: flags.isPlatformAdmin } : {}) } });
  },

  async createUser(data) {
    const db = getPrisma();
    const email = data.email.toLowerCase();
    if (await db.user.findUnique({ where: { email } })) throw new Error("A user with that email already exists.");
    const row = await db.user.create({ data: { email, name: data.name, passwordHash: data.passwordHash, isOperator: data.isOperator ?? false, isPlatformAdmin: data.isPlatformAdmin ?? false } });
    return toUser(row);
  },

  async setUserPassword(userId, passwordHash) {
    await getPrisma().user.update({ where: { id: userId }, data: { passwordHash, sessionVersion: { increment: 1 } } });
  },

  async ping() {
    const db = getPrisma();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), 3000);
    });
    const query = db.$queryRaw`SELECT 1`.then(
      () => true,
      () => false,
    );
    const result = await Promise.race([query, timeout]);
    if (timer) clearTimeout(timer);
    return result;
  },

  async recordHeartbeat(key, at) {
    await getPrisma().heartbeat.upsert({ where: { key }, update: { at }, create: { key, at } });
  },

  async getHeartbeat(key) {
    return (await getPrisma().heartbeat.findUnique({ where: { key } }))?.at ?? null;
  },

  async rateLimitHit(key, windowMs, now = new Date()) {
    const expiredBefore = new Date(now.getTime() - windowMs);
    const rows = await getPrisma().$queryRaw<{ count: number; windowStart: Date }[]>`
      INSERT INTO "RateLimitBucket" ("key", "count", "windowStart") VALUES (${key}, 1, ${now})
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "RateLimitBucket"."windowStart" <= ${expiredBefore} THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
        "windowStart" = CASE WHEN "RateLimitBucket"."windowStart" <= ${expiredBefore} THEN ${now} ELSE "RateLimitBucket"."windowStart" END
      RETURNING "count", "windowStart"`;
    const row = rows[0];
    if (!row) throw new Error("rate limit upsert returned no row");
    return { count: Number(row.count), windowStart: new Date(row.windowStart) };
  },

  async rateLimitPeek(key, windowMs, now = new Date()) {
    const row = await getPrisma().rateLimitBucket.findUnique({ where: { key } });
    if (!row || row.windowStart.getTime() <= now.getTime() - windowMs) return 0;
    return row.count;
  },

  async rateLimitClear(key) {
    await getPrisma().rateLimitBucket.deleteMany({ where: { key } });
  },

  async createOnboarding(data) {
    const row = await getPrisma().onboardingSubmission.create({ data: { tokenHash: data.tokenHash, label: data.label, contactEmail: data.contactEmail ?? null, createdById: data.createdById ?? null, expiresAt: data.expiresAt } });
    return toOnboarding(row);
  },

  async findOnboardingByTokenHash(tokenHash) {
    const row = await getPrisma().onboardingSubmission.findUnique({ where: { tokenHash } });
    return row ? toOnboarding(row) : null;
  },

  async findOnboardingById(id) {
    const row = await getPrisma().onboardingSubmission.findUnique({ where: { id } });
    return row ? toOnboarding(row) : null;
  },

  async listOnboardings(opts = {}) {
    const rows = await getPrisma().onboardingSubmission.findMany({ orderBy: { updatedAt: "desc" }, take: opts.limit ?? 200 });
    return rows.map(toOnboarding);
  },

  async updateOnboarding(id, patch) {
    const data = { ...(patch.answers !== undefined ? { answers: json(patch.answers) } : {}), ...(patch.status !== undefined ? { status: patch.status } : {}), ...(patch.tokenHash !== undefined ? { tokenHash: patch.tokenHash } : {}), ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt } : {}), ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}), ...(patch.submittedAt !== undefined ? { submittedAt: patch.submittedAt } : {}), ...(patch.provisionedAt !== undefined ? { provisionedAt: patch.provisionedAt } : {}), ...(patch.tenantId !== undefined ? { tenantId: patch.tenantId } : {}) };
    const result = await getPrisma().onboardingSubmission.updateMany({ where: { id }, data });
    if (result.count === 0) return null;
    const row = await getPrisma().onboardingSubmission.findUnique({ where: { id } });
    return row ? toOnboarding(row) : null;
  },

  async upsertMembership(tenantId, userId, roleId, profile) {
    const fields = { ...(profile?.title !== undefined ? { title: profile.title } : {}), ...(profile?.phone !== undefined ? { phone: profile.phone } : {}), ...(profile?.photoUrl !== undefined ? { photoUrl: profile.photoUrl } : {}) };
    await getPrisma().membership.upsert({ where: { tenantId_userId: { tenantId, userId } }, update: { roleId, ...fields }, create: { tenantId, userId, roleId, ...fields } });
  },

  async removeMembership(tenantId, userId) {
    await getPrisma().membership.deleteMany({ where: { tenantId, userId } });
  },

  async assignOperator(tenantId, userId) {
    await getPrisma().operatorAssignment.upsert({ where: { tenantId_userId: { tenantId, userId } }, update: {}, create: { tenantId, userId } });
  },

  async listOperators() {
    const rows = await getPrisma().user.findMany({ where: { OR: [{ isOperator: true }, { isPlatformAdmin: true }] }, orderBy: { email: "asc" } });
    return rows.map(toUser);
  },

  async createApiKey(tenantId, data) {
    const row = await getPrisma().tenantApiKey.create({ data: { tenantId, label: data.label, keyHash: data.keyHash, keyPrefix: data.keyPrefix, scopes: data.scopes } });
    return toApiKey(row);
  },

  async listApiKeys(tenantId) {
    const rows = await getPrisma().tenantApiKey.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
    return rows.map(toApiKey);
  },

  async revokeApiKey(tenantId, keyId) {
    await getPrisma().tenantApiKey.updateMany({ where: { id: keyId, tenantId }, data: { revokedAt: new Date() } });
  },

  async listInventory(tenantId, opts = {}) {
    const rows = await getPrisma().inventoryItem.findMany({ where: { tenantId, ...(opts.type ? { type: opts.type } : {}), ...(opts.status ? { status: { in: opts.status } } : {}) }, orderBy: { updatedAt: "desc" }, take: opts.limit ?? 500 });
    return rows.map(toInventory);
  },

  async upsertInventoryItems(tenantId, items) {
    const db = getPrisma();
    const created: InventoryItemRecord[] = [];
    let updated = 0;
    for (const it of items) {
      const existing = it.externalId ? await db.inventoryItem.findFirst({ where: { tenantId, externalId: it.externalId } }) : await db.inventoryItem.findFirst({ where: { tenantId, type: it.type, name: { equals: it.name, mode: "insensitive" } } });
      if (existing) {
        await db.inventoryItem.update({ where: { id: existing.id }, data: { name: it.name, status: it.status ?? existing.status, quantity: it.quantity ?? existing.quantity, valueCents: it.valueCents ?? existing.valueCents, attributes: json({ ...obj(existing.attributes), ...(it.attributes ?? {}) }), source: it.source ?? existing.source } });
        updated++;
        continue;
      }
      const row = await db.inventoryItem.create({ data: { tenantId, type: it.type, externalId: it.externalId ?? null, name: it.name, status: it.status ?? "ACTIVE", quantity: it.quantity ?? null, valueCents: it.valueCents ?? null, attributes: json(it.attributes ?? {}), source: it.source ?? null } });
      created.push(toInventory(row));
    }
    return { created, updated };
  },

  // --- ads, attribution, finance, website (Phase 4) --------------------------------

  async listAdAccounts(tenantId, opts = {}) {
    const rows = await getPrisma().adAccount.findMany({ where: { tenantId, ...(opts.activeOnly ? { isActive: true } : {}) }, orderBy: { createdAt: "asc" } });
    return rows.map(toAdAccount);
  },

  async upsertAdAccount(tenantId, data) {
    const db = getPrisma();
    const existing = await db.adAccount.findUnique({ where: { tenantId_platform_externalAccountId: { tenantId, platform: data.platform, externalAccountId: data.externalAccountId } } });
    const row = existing
      ? await db.adAccount.update({ where: { id: existing.id }, data: { name: data.name ?? existing.name, currency: data.currency ?? existing.currency, monthlyBudgetCents: data.monthlyBudgetCents === undefined ? existing.monthlyBudgetCents : data.monthlyBudgetCents, isActive: data.isActive ?? existing.isActive, settings: json({ ...obj(existing.settings), ...(data.settings ?? {}) }) } })
      : await db.adAccount.create({ data: { tenantId, platform: data.platform, externalAccountId: data.externalAccountId, name: data.name ?? null, currency: data.currency ?? "AUD", monthlyBudgetCents: data.monthlyBudgetCents ?? null, isActive: data.isActive ?? true, settings: json(data.settings ?? {}) } });
    return toAdAccount(row);
  },

  async updateAdAccount(tenantId, adAccountId, patch) {
    await getPrisma().adAccount.updateMany({ where: { id: adAccountId, tenantId }, data: patch });
  },

  async recordAdSpend(tenantId, rows) {
    const db = getPrisma();
    let n = 0;
    for (const r of rows) {
      const date = utcDay(r.date);
      const values = { campaignName: r.campaignName, spendCents: r.spendCents, impressions: r.impressions ?? null, clicks: r.clicks ?? null, platformLeads: r.platformLeads ?? null, raw: json(r.raw ?? {}) };
      // Prisma cannot upsert on a unique that includes a nullable column, so find-then-write.
      const existing = await db.adSpendSnapshot.findFirst({ where: { adAccountId: r.adAccountId, date, campaignId: r.campaignId ?? null } });
      if (existing) await db.adSpendSnapshot.update({ where: { id: existing.id }, data: values });
      else await db.adSpendSnapshot.create({ data: { tenantId, adAccountId: r.adAccountId, platform: r.platform, date, campaignId: r.campaignId ?? null, ...values } });
      n++;
    }
    return n;
  },

  async listAdSpend(tenantId, opts) {
    const rows = await getPrisma().adSpendSnapshot.findMany({ where: { tenantId, date: { gte: opts.from, ...(opts.to ? { lt: opts.to } : {}) }, ...(opts.adAccountId ? { adAccountId: opts.adAccountId } : {}) }, orderBy: { date: "asc" } });
    return rows.map(toAdSpend);
  },

  async sumAdSpend(tenantId, from, to, currency) {
    const db = getPrisma();
    const accounts = currency ? (await db.adAccount.findMany({ where: { tenantId, currency: currency.toUpperCase() }, select: { id: true } })).map((a) => a.id) : null;
    if (accounts && accounts.length === 0) return 0;
    const agg = await db.adSpendSnapshot.aggregate({ where: { tenantId, date: { gte: from, ...(to ? { lt: to } : {}) }, ...(accounts ? { adAccountId: { in: accounts } } : {}) }, _sum: { spendCents: true } });
    return agg._sum.spendCents ?? 0;
  },

  async listLeadsBetween(tenantId, from, to, limit = 2000) {
    const rows = await getPrisma().lead.findMany({ where: { tenantId, createdAt: { gte: from, ...(to ? { lt: to } : {}) } }, orderBy: { createdAt: "desc" }, take: limit });
    return rows.map(toLead);
  },

  async upsertTransactions(tenantId, rows) {
    const db = getPrisma();
    let fresh = 0;
    // Money shows against the lead it came from: the contact's most recent lead that was not lost, found once per contact.
    const leadForContact = new Map<string, string | null>();
    const leadFor = async (contactId: string | null): Promise<string | null> => {
      if (!contactId) return null;
      if (!leadForContact.has(contactId)) {
        const lead = await db.lead.findFirst({ where: { tenantId, contactId, status: { notIn: ["LOST", "ARCHIVED"] } }, orderBy: { createdAt: "desc" }, select: { id: true } });
        leadForContact.set(contactId, lead?.id ?? null);
      }
      return leadForContact.get(contactId) ?? null;
    };
    for (const r of rows) {
      const contactId = r.contactId ?? (r.customerEmail ? (await db.contact.findFirst({ where: { tenantId, email: r.customerEmail.toLowerCase() }, select: { id: true } }))?.id ?? null : null);
      const existing = await db.transaction.findUnique({ where: { tenantId_provider_providerId: { tenantId, provider: r.provider, providerId: r.providerId } } });
      if (existing) {
        const linkedContact = existing.contactId ?? contactId;
        await db.transaction.update({ where: { id: existing.id }, data: { status: r.status, amountCents: r.amountCents, note: r.note ?? existing.note, contactId: linkedContact, leadId: existing.leadId ?? r.leadId ?? (await leadFor(linkedContact)) } });
        continue;
      }
      await db.transaction.create({ data: { tenantId, contactId, leadId: r.leadId ?? (await leadFor(contactId)), provider: r.provider, providerId: r.providerId, kind: r.kind, status: r.status, amountCents: r.amountCents, currency: r.currency, note: r.note ?? null, occurredAt: r.occurredAt, rawPayload: json(r.rawPayload ?? {}) } });
      fresh++;
    }
    return fresh;
  },

  async listTransactions(tenantId, opts) {
    const rows = await getPrisma().transaction.findMany({ where: { tenantId, occurredAt: { gte: opts.from, ...(opts.to ? { lt: opts.to } : {}) }, ...(opts.status ? { status: { in: opts.status } } : {}), ...(opts.kinds ? { kind: { in: opts.kinds } } : {}) }, orderBy: { occurredAt: "desc" }, take: opts.limit ?? 500 });
    return rows.map(toTxn);
  },

  async upsertInvoices(tenantId, rows) {
    const db = getPrisma();
    const paidNow: InvoiceRecord[] = [];
    let written = 0;
    for (const r of rows) {
      const contactId = r.contactId ?? (r.customerEmail ? (await db.contact.findFirst({ where: { tenantId, email: r.customerEmail.toLowerCase() }, select: { id: true } }))?.id ?? null : null);
      const existing = await db.invoice.findUnique({ where: { tenantId_provider_externalId: { tenantId, provider: r.provider, externalId: r.externalId } } });
      const values = { number: r.number ?? existing?.number ?? null, amountCents: r.amountCents, amountDueCents: r.amountDueCents, currency: r.currency, status: r.status, issuedAt: r.issuedAt ?? existing?.issuedAt ?? null, dueAt: r.dueAt ?? existing?.dueAt ?? null, paidAt: r.paidAt ?? existing?.paidAt ?? null, url: r.url ?? existing?.url ?? null, customerName: r.customerName ?? existing?.customerName ?? null, customerEmail: r.customerEmail ?? existing?.customerEmail ?? null, rawPayload: json(r.rawPayload ?? {}) };
      const row = existing
        ? await db.invoice.update({ where: { id: existing.id }, data: { ...values, contactId: existing.contactId ?? contactId } })
        : await db.invoice.create({ data: { tenantId, contactId, provider: r.provider, externalId: r.externalId, ...values } });
      written++;
      if (row.status === "PAID" && existing?.status !== "PAID") paidNow.push(toInvoice(row));
    }
    return { written, paidNow };
  },

  async listInvoices(tenantId, opts = {}) {
    const rows = await getPrisma().invoice.findMany({ where: { tenantId, ...(opts.status ? { status: { in: opts.status } } : {}), ...(opts.dueBefore ? { dueAt: { lt: opts.dueBefore } } : {}) }, orderBy: { dueAt: { sort: "asc", nulls: "last" } }, take: opts.limit ?? 200 });
    return rows.map(toInvoice);
  },

  async updateInvoice(tenantId, invoiceId, patch) {
    await getPrisma().invoice.updateMany({ where: { id: invoiceId, tenantId }, data: patch });
  },

  async createTrackedLink(tenantId, data) {
    const row = await getPrisma().trackedLink.create({ data: { tenantId, code: data.code, destination: data.destination, label: data.label ?? null, source: data.source ?? null, medium: data.medium ?? null, campaign: data.campaign ?? null, content: data.content ?? null } });
    return toLink(row);
  },

  async listTrackedLinks(tenantId, limit = 100) {
    const rows = await getPrisma().trackedLink.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: limit });
    return rows.map(toLink);
  },

  async findTrackedLinkByCode(code) {
    const row = await getPrisma().trackedLink.findUnique({ where: { code } });
    return row ? toLink(row) : null;
  },

  async incrementTrackedLinkClicks(linkId) {
    await getPrisma().trackedLink.update({ where: { id: linkId }, data: { clicks: { increment: 1 } } });
  },

  async recordWebEvents(tenantId, events) {
    if (events.length === 0) return;
    await getPrisma().webEvent.createMany({ data: events.map((e) => ({ tenantId, kind: e.kind, path: e.path ?? null, referrer: e.referrer ?? null, source: e.source ?? null, sessionKey: e.sessionKey ?? null, occurredAt: e.occurredAt ?? new Date() })) });
  },

  async listWebEvents(tenantId, from, to, limit = 20_000) {
    const rows = await getPrisma().webEvent.findMany({ where: { tenantId, occurredAt: { gte: from, lt: to } }, orderBy: { occurredAt: "asc" }, take: limit });
    return rows.map(toWebEvent);
  },

  async pruneWebEvents(tenantId, before) {
    const { count } = await getPrisma().webEvent.deleteMany({ where: { tenantId, occurredAt: { lt: before } } });
    return count;
  },

  async recordSiteMetrics(tenantId, data) {
    const date = utcDay(data.date);
    const values = { sessions: data.sessions, pageviews: data.pageviews, formStarts: data.formStarts, formSubmits: data.formSubmits, linkClicks: data.linkClicks, topPages: json(data.topPages), topSources: json(data.topSources) };
    await getPrisma().siteMetricSnapshot.upsert({ where: { tenantId_date: { tenantId, date } }, create: { tenantId, date, ...values }, update: values });
  },

  async listSiteMetrics(tenantId, since) {
    const rows = await getPrisma().siteMetricSnapshot.findMany({ where: { tenantId, date: { gte: since } }, orderBy: { date: "asc" } });
    return rows.map(toSiteMetrics);
  },

  async getPortalHome(tenantId, opts) {
    const db = getPrisma();
    const monthStart = startOfMonthInZone(opts.timezone);
    const dayStart = startOfDayInZone(opts.timezone);
    const weekStart = new Date(dayStart.getTime() - 6 * 24 * 60 * 60_000);

    const openWhere = { tenantId, status: { in: OPEN_MISSED }, ...(opts.onlyAssigneeId ? { lead: { assigneeId: opts.onlyAssigneeId } } : {}) } satisfies Prisma.MissedOpportunityWhereInput;
    const [needsYou, open, atRisk, recovered, leadsMonth, revenue, contentAwaiting, runs, countToday, countWeek, adSpendMonthCents, expenses, openInvoices] = await Promise.all([
      this.listNeedsYou(tenantId, { onlyAssigneeId: opts.onlyAssigneeId, limit: 8 }),
      db.missedOpportunity.findMany({ where: openWhere, orderBy: { detectedAt: "desc" }, take: 20 }),
      // The headline sums every open item, not just the twenty shown.
      db.missedOpportunity.aggregate({ where: openWhere, _sum: { estimatedValueCents: true } }),
      db.missedOpportunity.aggregate({ where: { tenantId, status: "RECOVERED", resolvedAt: { gte: monthStart } }, _sum: { recoveredValueCents: true } }),
      db.lead.count({ where: { tenantId, createdAt: { gte: monthStart } } }),
      db.transaction.aggregate({ where: { tenantId, status: "COMPLETED", currency: opts.currency, occurredAt: { gte: monthStart } }, _sum: { amountCents: true } }),
      db.contentAsset.findMany({ where: { tenantId, status: "IN_REVIEW" }, orderBy: { createdAt: "desc" }, take: 10 }),
      db.automationRun.findMany({ where: { tenantId, ...(opts.onlyAssigneeId ? { lead: { assigneeId: opts.onlyAssigneeId } } : {}) }, orderBy: { createdAt: "desc" }, take: 6 }),
      db.automationRun.count({ where: { tenantId, createdAt: { gte: dayStart } } }),
      db.automationRun.count({ where: { tenantId, createdAt: { gte: weekStart } } }),
      this.sumAdSpend(tenantId, monthBucketInZone(opts.timezone), undefined, opts.currency),
      db.transaction.aggregate({ where: { tenantId, kind: "EXPENSE", status: "COMPLETED", currency: opts.currency, occurredAt: { gte: monthStart } }, _sum: { amountCents: true } }),
      db.invoice.findMany({ where: { tenantId, status: { in: ["SENT", "OVERDUE"] } }, select: { amountDueCents: true, status: true, dueAt: true } }),
    ]);
    const revenueMonthCents = revenue._sum.amountCents ?? 0;
    const expensesMonthCents = expenses._sum.amountCents ?? 0;
    const overdue = openInvoices.filter((i) => i.status === "OVERDUE" || (i.dueAt && i.dueAt.getTime() < Date.now()));
    return {
      needsYou,
      missed: { open: open.map(toMissed), atRiskCents: atRisk._sum.estimatedValueCents ?? 0, recoveredCents: recovered._sum.recoveredValueCents ?? 0 },
      money: opts.canViewFinances
        ? {
            revenueMonthCents,
            adSpendMonthCents,
            leadsMonth,
            costPerLeadCents: adSpendMonthCents > 0 && leadsMonth > 0 ? Math.round(adSpendMonthCents / leadsMonth) : null,
            currency: opts.currency,
            outstandingCents: openInvoices.reduce((sum, i) => sum + i.amountDueCents, 0),
            overdueCents: overdue.reduce((sum, i) => sum + i.amountDueCents, 0),
            overdueCount: overdue.length,
            expensesMonthCents,
            profitMonthCents: revenueMonthCents - expensesMonthCents - adSpendMonthCents,
          }
        : null,
      contentAwaiting: contentAwaiting.map(toAsset),
      handled: { runs: runs.map(toRun), countToday, countWeek },
    } satisfies PortalHome;
  },

  async getPortfolio(tenants, now = new Date()) {
    const db = getPrisma();
    const rowFor = async (tenant: TenantSummary): Promise<PortfolioRow> => {
      const dayStart = startOfDayInZone(tenant.timezone, now);
      const [slaBreaches, open, exceptionsOpen, contentDue, integrations, leadsToday, budget, spentCents] = await Promise.all([
        this.countLeadsPastSla(tenant.id, now),
        db.missedOpportunity.aggregate({ where: { tenantId: tenant.id, status: { in: OPEN_MISSED } }, _count: { _all: true }, _sum: { estimatedValueCents: true } }),
        db.exceptionItem.count({ where: { tenantId: tenant.id, status: { not: "RESOLVED" } } }),
        db.contentAsset.count({ where: { tenantId: tenant.id, status: "IN_REVIEW" } }),
        db.integration.findMany({ where: { tenantId: tenant.id }, select: { provider: true, status: true, lastError: true } }),
        db.lead.count({ where: { tenantId: tenant.id, createdAt: { gte: dayStart } } }),
        // Budget and spend must be in the same currency to compare; accounts in another currency are left out of both.
        db.adAccount.aggregate({ where: { tenantId: tenant.id, isActive: true, currency: tenant.currency.toUpperCase() }, _sum: { monthlyBudgetCents: true } }),
        this.sumAdSpend(tenant.id, monthBucketInZone(tenant.timezone, now), undefined, tenant.currency),
      ]);
      const budgetCents = budget._sum.monthlyBudgetCents ?? 0;
      const { daysElapsed, daysInMonth } = monthProgressInZone(tenant.timezone, now);
      const base = {
        tenant,
        slaBreaches,
        missedOpen: open._count._all,
        missedAtRiskCents: open._sum.estimatedValueCents ?? 0,
        exceptionsOpen,
        contentDue,
        adPacing: budgetCents > 0 ? { spentCents, budgetCents, daysElapsed, daysInMonth } : null,
        integrations,
        leadsToday,
      };
      return { ...base, health: healthScore(base) };
    };
    // A handful of tenants at a time: the portfolio page should not open fifty connections, nor wait on them one by one.
    const rows: PortfolioRow[] = [];
    for (let i = 0; i < tenants.length; i += PORTFOLIO_CONCURRENCY) rows.push(...(await Promise.all(tenants.slice(i, i + PORTFOLIO_CONCURRENCY).map(rowFor))));
    return rows.sort((a, b) => a.health - b.health);
  },
};
