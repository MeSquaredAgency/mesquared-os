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
  type ContentAsset,
  type DomainEvent,
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
  AutomationRunRecord,
  BookingRecord,
  ContactRecord,
  ConversationRecord,
  FormSessionRecord,
  InformationRequestRecord,
  ReviewRecord,
  ScheduledActionRecord,
  ContentAssetRecord,
  DomainEventRecord,
  EscalationRule,
  ExceptionRecord,
  IntegrationRecord,
  LeadRecord,
  MissedOpportunityRecord,
  OpportunityValues,
  PipelineRecord,
  PortalHome,
  PortfolioRow,
  QualificationRules,
  ServiceLevels,
  SocialPlatform,
  SocialPostRecord,
  TenantAccess,
  TenantBranding,
  TenantRoleRecord,
  TenantSummary,
  TransactionRecord,
  UserRecord,
} from "@/lib/types";
import { startOfDayInZone, startOfMonthInZone } from "@/lib/utils";
import { TenantMismatchError, type NewContentAsset, type NewMessage, type Repository } from "./repository";

const toBooking = (b: Booking): BookingRecord => ({ id: b.id, tenantId: b.tenantId, leadId: b.leadId, provider: b.provider, externalId: b.externalId, bookingUrl: b.bookingUrl, startsAt: b.startsAt, endsAt: b.endsAt, status: b.status, confirmedAt: b.confirmedAt, remindedAt: b.remindedAt, followedUpAt: b.followedUpAt, createdAt: b.createdAt });
const toConversation = (c: Conversation): ConversationRecord => ({ id: c.id, tenantId: c.tenantId, contactId: c.contactId, channel: c.channel, externalId: c.externalId, lastMessageAt: c.lastMessageAt, awaitingReply: c.awaitingReply });
const toAction = (a: ScheduledAction): ScheduledActionRecord => ({ id: a.id, tenantId: a.tenantId, typeKey: a.typeKey, action: a.action, runAt: a.runAt, payload: obj(a.payload), dedupeKey: a.dedupeKey, status: a.status, attempts: a.attempts });
const toRequest = (r: InformationRequest): InformationRequestRecord => ({ id: r.id, tenantId: r.tenantId, contactId: r.contactId, leadId: r.leadId, kind: r.kind, description: r.description, dueAt: r.dueAt, status: r.status, chaseCount: r.chaseCount, lastChasedAt: r.lastChasedAt, receivedAt: r.receivedAt, createdAt: r.createdAt });
const toReview = (r: Review): ReviewRecord => ({ id: r.id, tenantId: r.tenantId, provider: r.provider, externalId: r.externalId, authorName: r.authorName, rating: r.rating, body: r.body, url: r.url, receivedAt: r.receivedAt, repliedAt: r.repliedAt });
const toFormSession = (f: FormSession): FormSessionRecord => ({ id: f.id, tenantId: f.tenantId, sessionKey: f.sessionKey, formName: f.formName, pageUrl: f.pageUrl, partial: obj(f.partial), startedAt: f.startedAt, lastSeenAt: f.lastSeenAt, submittedAt: f.submittedAt, convertedLeadId: f.convertedLeadId, flaggedAt: f.flaggedAt });

const json = (v: unknown) => v as Prisma.InputJsonValue;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
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

const toMissed = (m: MissedOpportunity): MissedOpportunityRecord => ({ id: m.id, tenantId: m.tenantId, type: m.type, status: m.status, contactId: m.contactId, leadId: m.leadId, estimatedValueCents: m.estimatedValueCents, recoveredValueCents: m.recoveredValueCents, summary: m.summary, detectedAt: m.detectedAt, resolvedAt: m.resolvedAt });
const toRun = (r: AutomationRun): AutomationRunRecord => ({ id: r.id, tenantId: r.tenantId, typeKey: r.typeKey, outcome: r.outcome, summary: r.summary, leadId: r.leadId, contactId: r.contactId, missedOpportunityId: r.missedOpportunityId, createdAt: r.createdAt });
const toException = (e: ExceptionItem): ExceptionRecord => ({ id: e.id, tenantId: e.tenantId, reason: e.reason, suggestedAction: e.suggestedAction, confidence: e.confidence, status: e.status, assignedOperatorId: e.assignedOperatorId, escalatedToUserId: e.escalatedToUserId, contactId: e.contactId, leadId: e.leadId, missedOpportunityId: e.missedOpportunityId, createdAt: e.createdAt });
const toEvent = (e: DomainEvent): DomainEventRecord => ({ id: e.id, tenantId: e.tenantId, type: e.type, payload: obj(e.payload), causationId: e.causationId, occurredAt: e.occurredAt });
const toTxn = (t: Transaction): TransactionRecord => ({ id: t.id, tenantId: t.tenantId, contactId: t.contactId, leadId: t.leadId, provider: t.provider, providerId: t.providerId, kind: t.kind, status: t.status, amountCents: t.amountCents, currency: t.currency, note: t.note, occurredAt: t.occurredAt });
const toAsset = (a: ContentAsset): ContentAssetRecord => ({ id: a.id, tenantId: a.tenantId, kind: a.kind, title: a.title, body: a.body, targetPlatform: a.targetPlatform, status: a.status, needsClientSignoff: a.needsClientSignoff, createdAt: a.createdAt });
const toPost = (p: SocialPost): SocialPostRecord => ({ id: p.id, tenantId: p.tenantId, platform: p.platform, caption: p.caption, tags: p.tags, status: p.status, scheduledFor: p.scheduledFor, batchId: p.batchId });

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
    return { tenant: toTenant(key.tenant), apiKeyId: key.id };
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
      const updated = await db.contact.update({
        where: { id: existing.id },
        data: {
          lastActivityAt: new Date(),
          firstName: existing.firstName ?? data.firstName,
          lastName: existing.lastName ?? data.lastName,
          email: existing.email ?? data.email,
          phone: existing.phone ?? data.phone,
          company: existing.company ?? data.company,
        },
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
    const [respond, book] = await Promise.all([
      db.lead.findMany({ where: { tenantId, ticketType: "GREEN", respondBy: { lt: now }, firstResponseAt: null, status: { notIn: ["LOST", "ARCHIVED"] } } }),
      db.lead.findMany({ where: { tenantId, ticketType: "GREEN", bookBy: { lt: now }, bookedAt: null, status: { in: ["QUALIFIED", "BOOKING_SENT"] } } }),
    ]);
    return { respond: respond.map(toLead), book: book.map(toLead) };
  },

  async findLeadById(tenantId, leadId) {
    const row = await getPrisma().lead.findFirst({ where: { id: leadId, tenantId } });
    return row ? toLead(row) : null;
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
        status: ["NEW", "QUALIFIED", "BOOKING_SENT"].includes(lead.status) ? "BOOKED" : lead.status,
        ...(next && next.id !== lead.stageId ? { stageId: next.id, stageEnteredAt: at } : {}),
      },
    });
    return toLead(updated);
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
          body: data.body,
          status: data.status,
          providerMessageId: data.providerMessageId ?? null,
          automationRunId: data.automationRunId ?? null,
          sentAt: data.direction === "OUTBOUND" && data.status !== "QUEUED" && data.status !== "FAILED" ? new Date() : null,
        },
      }),
      db.conversation.update({ where: { id: convo.id }, data: { lastMessageAt: new Date(), awaitingReply: data.direction === "INBOUND" } }),
      ...(data.contactId ? [db.contact.updateMany({ where: { id: data.contactId, tenantId }, data: { lastActivityAt: new Date() } })] : []),
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

  async findTenantByIntegrationAccount(provider, externalAccountId) {
    const i = await getPrisma().integration.findFirst({ where: { provider, externalAccountId, status: { not: "DISCONNECTED" }, tenant: { isActive: true } }, include: { tenant: true } });
    return i ? toTenant(i.tenant) : null;
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
    if (existing?.status === "PENDING") return { record: toAction(existing), created: false };
    if (existing) {
      const reset = await db.scheduledAction.update({ where: { id: existing.id }, data: { typeKey: data.typeKey, action: data.action, runAt: data.runAt, payload: json(data.payload ?? {}), status: "PENDING", attempts: 0, lastError: null, ranAt: null } });
      return { record: toAction(reset), created: true };
    }
    const row = await db.scheduledAction.create({ data: { tenantId, typeKey: data.typeKey, action: data.action, runAt: data.runAt, payload: json(data.payload ?? {}), dedupeKey: data.dedupeKey } });
    return { record: toAction(row), created: true };
  },

  async listDueActions(now, limit = 100) {
    const rows = await getPrisma().scheduledAction.findMany({ where: { status: "PENDING", runAt: { lte: now } }, orderBy: { runAt: "asc" }, take: limit });
    return rows.map(toAction);
  },

  async completeAction(actionId, status, error = null) {
    await getPrisma().scheduledAction.update({ where: { id: actionId }, data: { status, lastError: error, ranAt: new Date(), attempts: { increment: 1 } } });
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
    const rows = await getPrisma().formSession.findMany({ where: { tenantId, submittedAt: null, flaggedAt: null, lastSeenAt: { lt: idleBefore } }, orderBy: { lastSeenAt: "asc" }, take: limit * 2 });
    return rows.map(toFormSession).filter((f) => typeof f.partial.email === "string" || typeof f.partial.phone === "string").slice(0, limit);
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
    const rows = await getPrisma().lead.findMany({ where: { tenantId, stage: { quietAfterDays: { not: null } }, status: { notIn: ["WON", "LOST", "ARCHIVED"] } }, include: { stage: true } });
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
      // A previously resolved item for the same subject: reopen rather than violate the unique key.
      const reopened = await db.missedOpportunity.update({ where: { id: existing.id }, data: { status: "DETECTED", summary: data.summary, estimatedValueCents: data.estimatedValueCents, detectedAt: new Date(), resolvedAt: null } });
      return { record: toMissed(reopened), created: true };
    }
    const created = await db.missedOpportunity.create({
      data: { tenantId, type: data.type, contactId: data.contactId, leadId: data.leadId, estimatedValueCents: data.estimatedValueCents, summary: data.summary, dedupeKey: data.dedupeKey },
    });
    return { record: toMissed(created), created: true };
  },

  async listMissedOpportunities(tenantId, opts = {}) {
    const rows = await getPrisma().missedOpportunity.findMany({ where: { tenantId, ...(opts.status ? { status: { in: opts.status } } : {}) }, orderBy: { detectedAt: "desc" }, take: opts.limit ?? 50 });
    return rows.map(toMissed);
  },

  async resolveMissedOpportunity(tenantId, moId, status, recoveredValueCents) {
    const { count } = await getPrisma().missedOpportunity.updateMany({
      where: { id: moId, tenantId },
      data: { status, resolvedAt: status === "RECOVERED" || status === "EXPIRED" ? new Date() : null, ...(recoveredValueCents !== undefined ? { recoveredValueCents } : {}) },
    });
    if (count === 0) return null;
    const row = await getPrisma().missedOpportunity.findUnique({ where: { id: moId } });
    return row ? toMissed(row) : null;
  },

  async recordAutomationRun(tenantId, data) {
    await assertLeadInTenant(tenantId, data.leadId);
    await assertContactInTenant(tenantId, data.contactId);
    const row = await getPrisma().automationRun.create({
      data: { tenantId, typeKey: data.typeKey, outcome: data.outcome, summary: data.summary, details: json(data.details ?? {}), contactId: data.contactId ?? null, leadId: data.leadId ?? null, missedOpportunityId: data.missedOpportunityId ?? null },
    });
    return toRun(row);
  },

  async listAutomationRuns(tenantId, limit = 50) {
    const rows = await getPrisma().automationRun.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: limit });
    return rows.map(toRun);
  },

  async createException(tenantId, data) {
    await assertLeadInTenant(tenantId, data.leadId);
    await assertContactInTenant(tenantId, data.contactId);
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
    const { count } = await getPrisma().exceptionItem.updateMany({ where: { id: exId, tenantId }, data: { status: "RESOLVED", resolution, resolvedAt: new Date() } });
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
    const [assets, posts, channels] = await Promise.all([
      db.contentAsset.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 50 }),
      db.socialPost.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 50 }),
      db.channel.findMany({ where: { tenantId, isActive: true }, select: { platform: true } }),
    ]);
    return { assets: assets.map(toAsset), posts: posts.map(toPost), connectedPlatforms: Array.from(new Set(channels.map((c) => c.platform as SocialPlatform))) };
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
            generation: json({ tags: item.tags, scheduledFor: item.scheduledFor?.toISOString() ?? null }),
          },
        }),
      ),
    );
    return rows.map(toAsset);
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

  async getPortalHome(tenantId, opts) {
    const db = getPrisma();
    const monthStart = startOfMonthInZone(opts.timezone);
    const dayStart = startOfDayInZone(opts.timezone);
    const weekStart = new Date(dayStart.getTime() - 6 * 24 * 60 * 60_000);

    const [needsYou, open, recovered, leadsMonth, revenue, contentAwaiting, runs, countToday, countWeek] = await Promise.all([
      this.listNeedsYou(tenantId, { onlyAssigneeId: opts.onlyAssigneeId, limit: 8 }),
      db.missedOpportunity.findMany({ where: { tenantId, status: { in: OPEN_MISSED } }, orderBy: { detectedAt: "desc" }, take: 20 }),
      db.missedOpportunity.aggregate({ where: { tenantId, status: "RECOVERED", resolvedAt: { gte: monthStart } }, _sum: { recoveredValueCents: true } }),
      db.lead.count({ where: { tenantId, createdAt: { gte: monthStart } } }),
      db.transaction.aggregate({ where: { tenantId, status: "COMPLETED", currency: opts.currency, occurredAt: { gte: monthStart } }, _sum: { amountCents: true } }),
      db.contentAsset.findMany({ where: { tenantId, status: "IN_REVIEW" }, orderBy: { createdAt: "desc" }, take: 10 }),
      db.automationRun.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 6 }),
      db.automationRun.count({ where: { tenantId, createdAt: { gte: dayStart } } }),
      db.automationRun.count({ where: { tenantId, createdAt: { gte: weekStart } } }),
    ]);
    const adSpendMonthCents = 0; // Ads module lands in Phase 4.
    const revenueMonthCents = revenue._sum.amountCents ?? 0;
    return {
      needsYou,
      missed: { open: open.map(toMissed), atRiskCents: open.reduce((s, m) => s + m.estimatedValueCents, 0), recoveredCents: recovered._sum.recoveredValueCents ?? 0 },
      money: opts.canViewFinances ? { revenueMonthCents, adSpendMonthCents, leadsMonth, costPerLeadCents: adSpendMonthCents > 0 && leadsMonth > 0 ? Math.round(adSpendMonthCents / leadsMonth) : null, currency: opts.currency } : null,
      contentAwaiting: contentAwaiting.map(toAsset),
      handled: { runs: runs.map(toRun), countToday, countWeek },
    } satisfies PortalHome;
  },

  async getPortfolio(tenants, now = new Date()) {
    const db = getPrisma();
    const rows: PortfolioRow[] = [];
    for (const tenant of tenants) {
      const dayStart = startOfDayInZone(tenant.timezone, now);
      const [{ respond, book }, open, exceptionsOpen, contentDue, integrations, leadsToday] = await Promise.all([
        this.listLeadsPastSla(tenant.id, now),
        db.missedOpportunity.findMany({ where: { tenantId: tenant.id, status: { in: OPEN_MISSED } }, select: { estimatedValueCents: true } }),
        db.exceptionItem.count({ where: { tenantId: tenant.id, status: { not: "RESOLVED" } } }),
        db.contentAsset.count({ where: { tenantId: tenant.id, status: "IN_REVIEW" } }),
        db.integration.findMany({ where: { tenantId: tenant.id }, select: { provider: true, status: true, lastError: true } }),
        db.lead.count({ where: { tenantId: tenant.id, createdAt: { gte: dayStart } } }),
      ]);
      const base = {
        tenant,
        slaBreaches: respond.length + book.length,
        missedOpen: open.length,
        missedAtRiskCents: open.reduce((s, m) => s + m.estimatedValueCents, 0),
        exceptionsOpen,
        contentDue,
        adPacing: null,
        integrations,
        leadsToday,
      };
      rows.push({ ...base, health: healthScore(base) });
    }
    return rows.sort((a, b) => a.health - b.health);
  },
};
