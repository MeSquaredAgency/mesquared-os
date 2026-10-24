import { randomUUID } from "node:crypto";
import { healthScore } from "@/lib/health";
import type {
  AutomationRunRecord,
  BookingRecord,
  ContactRecord,
  ConversationRecord,
  FormSessionRecord,
  InformationRequestRecord,
  ReviewRecord,
  ScheduledActionRecord,
  ChannelMetricSnapshotRecord,
  ChannelRecord,
  ContentAssetRecord,
  DomainEventRecord,
  MessageRecord,
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
  type NewMessage,
  type NewSocialPost,
  type NewMissedOpportunity,
  type Repository,
} from "./repository";
import {
  demoAdSpendMonthCents,
  demoIntegrationSettings,
  demoApiKeyHashes,
  demoAssets,
  demoBookings,
  demoChannelMetrics,
  demoChannels,
  demoConfig,
  demoContacts,
  demoExceptions,
  demoIntegrations,
  demoLeads,
  demoMemberships,
  demoMissed,
  demoOperatorAssignments,
  demoPosts,
  demoReviews,
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
  bookings: BookingRecord[];
  actions: (ScheduledActionRecord & { lockedAt?: Date | null })[];
  requests: InformationRequestRecord[];
  reviews: ReviewRecord[];
  formSessions: FormSessionRecord[];
  intakeEvents: (IntakeEventInput & { id: string; tenantId: string; createdAt: Date })[];
  conversations: ConversationRecord[];
  messages: (NewMessage & { id: string; tenantId: string; conversationId: string; createdAt: Date })[];
  missed: MissedOpportunityRecord[];
  runs: AutomationRunRecord[];
  exceptions: ExceptionRecord[];
  events: DomainEventRecord[];
  integrations: IntegrationRecord[];
  assets: ContentAssetRecord[];
  posts: (SocialPostRecord & { lockedAt?: Date | null })[];
  channels: ChannelRecord[];
  channelMetrics: ChannelMetricSnapshotRecord[];
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
      bookings: [...demoBookings],
      actions: [],
      requests: [],
      reviews: [...demoReviews],
      formSessions: [],
      intakeEvents: [],
      conversations: [],
      messages: [],
      missed: [...demoMissed],
      runs: [...demoRuns],
      exceptions: [...demoExceptions],
      events: [],
      integrations: [...demoIntegrations],
      assets: [...demoAssets],
      posts: [...demoPosts],
      channels: [...demoChannels],
      channelMetrics: [...demoChannelMetrics],
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
/** Encrypted credentials stored by connect flows in demo mode (never seeded). */
const demoCredentials: Record<string, string | null> = {};
const SOURCE_KIND_SET = new Set<string>(["RAW_TEXT", "RAW_AUDIO", "RAW_VIDEO", "IMAGE", "TRANSCRIPT"]);
/** A resolved missed opportunity stays closed this long before the same signal may raise it again. */
const SNOOZE_MS = 7 * 86_400_000;

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

  async findTenantById(tenantId) {
    return store().tenants.find((t) => t.id === tenantId) ?? null;
  },

  async listAllTenants() {
    return store().tenants;
  },

  async findTenantByApiKeyHash(hash) {
    const tenantId = demoApiKeyHashes[hash];
    const tenant = tenantId ? store().tenants.find((t) => t.id === tenantId) : undefined;
    // Demo keys carry both scopes so every example in the README works without a database.
    return tenant ? { tenant, apiKeyId: null, scopes: ["intake", "content"] } : null;
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
      // Match on an identifier we already hold. Never attach a *new* email or phone from an
      // unauthenticated channel to an existing contact: that would redirect their messages.
      existing.lastActivityAt = new Date();
      existing.lapsedAt = null;
      existing.firstName ??= data.firstName;
      existing.lastName ??= data.lastName;
      existing.company ??= data.company;
      return existing;
    }
    const contact: ContactRecord = { id: id("ct"), tenantId, ...data, consent: {}, tags: [], lastActivityAt: new Date(), lapsedAt: null, createdAt: new Date() };
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
      stageEnteredAt: data.stageId ? new Date() : null,
      lastActivityAt: new Date(),
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

  async findLeadById(tenantId, leadId) {
    return store().leads.find((l) => l.id === leadId && l.tenantId === tenantId) ?? null;
  },

  async markLeadBooked(tenantId, leadId, at) {
    const lead = store().leads.find((l) => l.id === leadId && l.tenantId === tenantId);
    if (!lead) return null;
    lead.bookedAt ??= at;
    if (lead.status === "QUALIFIED" || lead.status === "BOOKING_SENT" || lead.status === "NEW") lead.status = "BOOKED";
    const pipeline = demoConfig[tenantId]?.pipelines.find((p) => p.id === lead.pipelineId);
    const next = pipeline?.stages.find((s) => s.advanceOn === "BOOKING_CREATED");
    if (next && lead.stageId !== next.id) {
      lead.stageId = next.id;
      lead.stageEnteredAt = at;
    }
    lead.lastActivityAt = at;
    return lead;
  },

  async unbookLead(tenantId, leadId, bookBy) {
    const lead = store().leads.find((l) => l.id === leadId && l.tenantId === tenantId);
    if (!lead || lead.status !== "BOOKED") return;
    lead.status = "BOOKING_SENT";
    lead.bookedAt = null;
    lead.bookBy = bookBy;
    lead.lastActivityAt = new Date();
  },

  async assignLead(tenantId, leadId, assigneeId) {
    const lead = store().leads.find((l) => l.id === leadId && l.tenantId === tenantId);
    if (lead) lead.assigneeId = assigneeId;
  },

  async markLeadResponded(tenantId, leadId, at) {
    const lead = store().leads.find((l) => l.id === leadId && l.tenantId === tenantId);
    if (lead && !lead.firstResponseAt) lead.firstResponseAt = at;
  },

  async createBooking(tenantId, data: NewBooking) {
    assertLeadInTenant(tenantId, data.leadId);
    const booking: BookingRecord = { id: id("bk"), tenantId, leadId: data.leadId, provider: "CALCOM", externalId: null, bookingUrl: data.bookingUrl, startsAt: null, endsAt: null, status: data.sent ? "LINK_SENT" : "LINK_PENDING", confirmedAt: null, remindedAt: null, followedUpAt: null, createdAt: new Date() };
    pushBounded(store().bookings, booking, false);
    if (data.sent) {
      const lead = store().leads.find((l) => l.id === data.leadId && l.tenantId === tenantId);
      if (lead) lead.status = "BOOKING_SENT";
    }
    return { id: booking.id, bookingUrl: data.bookingUrl };
  },

  async recordIntakeEvent(tenantId, data) {
    assertLeadInTenant(tenantId, data.leadId);
    assertContactInTenant(tenantId, data.contactId);
    pushBounded(store().intakeEvents, { ...data, id: randomUUID(), tenantId, createdAt: new Date() }, false);
  },

  async recordMessage(tenantId, data: NewMessage) {
    assertContactInTenant(tenantId, data.contactId);
    const s = store();
    let convo = s.conversations.find((c) => c.tenantId === tenantId && c.channel === data.channel && (data.externalConversationId ? c.externalId === data.externalConversationId : c.contactId === data.contactId && c.contactId !== null));
    if (!convo) {
      convo = { id: id("cv"), tenantId, contactId: data.contactId, channel: data.channel, externalId: data.externalConversationId ?? null, lastMessageAt: new Date(), awaitingReply: false };
      pushBounded(s.conversations, convo, false);
    }
    if (data.contactId && data.direction === "INBOUND") {
      const c = s.contacts.find((x) => x.id === data.contactId);
      if (c) {
        c.lastActivityAt = new Date();
        c.lapsedAt = null;
      }
    }
    convo.lastMessageAt = new Date();
    convo.awaitingReply = data.direction === "INBOUND";
    const message = { ...data, id: id("msg"), tenantId, conversationId: convo.id, createdAt: new Date() };
    pushBounded(s.messages, message, false);
    return { conversationId: convo.id, messageId: message.id };
  },

  async listAlertRecipients(tenantId) {
    const s = store();
    return demoMemberships
      .filter((mb) => mb.tenantId === tenantId)
      .map((mb) => ({ mb, role: demoConfig[tenantId]?.roles.find((r) => r.id === mb.roleId), user: s.users.find((u) => u.id === mb.userId) }))
      .filter((x) => x.user && x.role?.permissions.includes("RECEIVE_LEAD_ALERTS"))
      .map((x) => ({ userId: x.user!.id, email: x.user!.email, name: x.user!.name }));
  },

  async findIntegration(tenantId, provider) {
    const i = store().integrations.find((x) => x.tenantId === tenantId && x.provider === provider);
    return i ? { id: i.id, provider: i.provider, status: i.status, externalAccountId: i.externalAccountId, settings: demoIntegrationSettings[i.id] ?? {}, credentialsEnc: demoCredentials[i.id] ?? null } : null;
  },

  async upsertIntegration(tenantId, data) {
    const s = store();
    const existing = s.integrations.find((i) => i.tenantId === tenantId && i.provider === data.provider);
    if (existing) {
      Object.assign(existing, { externalAccountId: data.externalAccountId || existing.externalAccountId, label: data.label === undefined ? existing.label : data.label, status: data.status ?? existing.status, lastError: data.lastError === undefined ? existing.lastError : data.lastError, lastSyncAt: data.lastSyncAt === undefined ? existing.lastSyncAt : data.lastSyncAt });
      if (data.credentialsEnc !== undefined) demoCredentials[existing.id] = data.credentialsEnc;
      if (data.settings) demoIntegrationSettings[existing.id] = { ...(demoIntegrationSettings[existing.id] ?? {}), ...data.settings };
      return { id: existing.id, provider: existing.provider, status: existing.status, externalAccountId: existing.externalAccountId, settings: demoIntegrationSettings[existing.id] ?? {}, credentialsEnc: demoCredentials[existing.id] ?? null };
    }
    const row: IntegrationRecord = { id: id("int"), tenantId, provider: data.provider, label: data.label ?? null, status: data.status ?? "PENDING", externalAccountId: data.externalAccountId, lastSyncAt: data.lastSyncAt ?? null, lastError: data.lastError ?? null };
    s.integrations.push(row);
    if (data.credentialsEnc) demoCredentials[row.id] = data.credentialsEnc;
    if (data.settings) demoIntegrationSettings[row.id] = data.settings;
    return { id: row.id, provider: row.provider, status: row.status, externalAccountId: row.externalAccountId, settings: demoIntegrationSettings[row.id] ?? {}, credentialsEnc: demoCredentials[row.id] ?? null };
  },

  async findTenantByIntegrationAccount(provider, externalAccountId) {
    const i = store().integrations.find((x) => x.provider === provider && x.externalAccountId === externalAccountId && x.status !== "DISCONNECTED");
    return i ? (store().tenants.find((t) => t.id === i.tenantId) ?? null) : null;
  },

  async findBookingById(tenantId, bookingId) {
    return store().bookings.find((b) => b.id === bookingId && b.tenantId === tenantId) ?? null;
  },

  async findLatestBookingForLead(tenantId, leadId) {
    return [...store().bookings].reverse().find((b) => b.tenantId === tenantId && b.leadId === leadId) ?? null;
  },

  async listBookings(tenantId, opts) {
    const statuses = opts.status ? new Set(opts.status) : null;
    return store()
      .bookings.filter(
        (b) =>
          b.tenantId === tenantId &&
          (!statuses || statuses.has(b.status)) &&
          (!opts.startsBefore || (b.startsAt && b.startsAt < opts.startsBefore)) &&
          (!opts.startsAfter || (b.startsAt && b.startsAt > opts.startsAfter)) &&
          (!opts.endsBefore || (b.endsAt && b.endsAt < opts.endsBefore)),
      )
      .slice(0, opts.limit ?? 100);
  },

  async updateBooking(tenantId, bookingId, patch) {
    const b = store().bookings.find((x) => x.id === bookingId && x.tenantId === tenantId);
    if (!b) return null;
    Object.assign(b, patch);
    return b;
  },

  async scheduleAction(tenantId, data) {
    const existing = store().actions.find((a) => a.tenantId === tenantId && a.dedupeKey === data.dedupeKey && a.status === "PENDING");
    if (existing) return { record: existing, created: false };
    const record: ScheduledActionRecord = { id: id("act"), tenantId, typeKey: data.typeKey, action: data.action, runAt: data.runAt, payload: data.payload ?? {}, dedupeKey: data.dedupeKey, status: "PENDING", attempts: 0 };
    pushBounded(store().actions, record, false);
    return { record, created: true };
  },

  async listDueActions(now, limit = 100) {
    return store()
      .actions.filter((a) => (a.status === "PENDING" || (a.status === "RUNNING" && a.lockedAt && now.getTime() - a.lockedAt.getTime() > 10 * 60_000)) && a.runAt <= now)
      .sort((a, b) => a.runAt.getTime() - b.runAt.getTime())
      .slice(0, limit);
  },

  async claimAction(actionId, now, leaseMs) {
    const a = store().actions.find((x) => x.id === actionId);
    if (!a) return false;
    const stale = a.status === "RUNNING" && a.lockedAt && now.getTime() - a.lockedAt.getTime() > leaseMs;
    if (a.status !== "PENDING" && !stale) return false;
    a.status = "RUNNING";
    a.lockedAt = now;
    return true;
  },

  async completeAction(actionId, status, error = null, retryAt) {
    const a = store().actions.find((x) => x.id === actionId);
    if (!a) return;
    a.status = status;
    a.attempts += 1;
    a.lockedAt = null;
    if (status === "PENDING" && retryAt) a.runAt = retryAt;
    void error;
  },

  async countOutboundMessages(tenantId, opts) {
    return store().messages.filter((x) => x.tenantId === tenantId && x.direction === "OUTBOUND" && x.status !== "FAILED" && x.createdAt >= opts.since && (!opts.to || x.to === opts.to)).length;
  },

  async cancelActions(tenantId, dedupePrefix) {
    let n = 0;
    for (const a of store().actions) {
      if (a.tenantId === tenantId && a.status === "PENDING" && a.dedupeKey.startsWith(dedupePrefix)) {
        a.status = "CANCELLED";
        n++;
      }
    }
    return n;
  },

  async createInformationRequest(tenantId, data) {
    assertLeadInTenant(tenantId, data.leadId);
    assertContactInTenant(tenantId, data.contactId);
    const req: InformationRequestRecord = { id: id("req"), tenantId, ...data, status: "OPEN", chaseCount: 0, lastChasedAt: null, receivedAt: null, createdAt: new Date() };
    pushBounded(store().requests, req);
    return req;
  },

  async findInformationRequestById(tenantId, requestId) {
    return store().requests.find((r) => r.tenantId === tenantId && r.id === requestId) ?? null;
  },

  async listInformationRequests(tenantId, opts = {}) {
    const statuses = new Set(opts.status ?? ["OPEN", "ESCALATED"]);
    return store()
      .requests.filter((r) => r.tenantId === tenantId && statuses.has(r.status))
      .slice(0, opts.limit ?? 100);
  },

  async updateInformationRequest(tenantId, requestId, patch) {
    const r = store().requests.find((x) => x.id === requestId && x.tenantId === tenantId);
    if (!r) return null;
    Object.assign(r, patch);
    return r;
  },

  async upsertReview(tenantId, data) {
    const existing = store().reviews.find((r) => r.tenantId === tenantId && r.provider === data.provider && r.externalId === data.externalId);
    if (existing) return { record: existing, created: false };
    const record: ReviewRecord = { id: id("rv"), tenantId, ...data, repliedAt: null };
    pushBounded(store().reviews, record);
    return { record, created: true };
  },

  async listReviews(tenantId, opts = {}) {
    return store()
      .reviews.filter((r) => r.tenantId === tenantId && (!opts.unansweredOnly || !r.repliedAt) && (!opts.receivedBefore || r.receivedAt < opts.receivedBefore))
      .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
      .slice(0, opts.limit ?? 100);
  },

  async markReviewReplied(tenantId, reviewId) {
    const r = store().reviews.find((x) => x.id === reviewId && x.tenantId === tenantId);
    if (!r) return null;
    r.repliedAt = new Date();
    return r;
  },

  async upsertFormSession(tenantId, data) {
    const s = store();
    let fsn = s.formSessions.find((f) => f.tenantId === tenantId && f.sessionKey === data.sessionKey);
    if (!fsn) {
      fsn = { id: id("fs"), tenantId, sessionKey: data.sessionKey, formName: data.formName, pageUrl: data.pageUrl, partial: {}, startedAt: new Date(), lastSeenAt: new Date(), submittedAt: null, convertedLeadId: null, flaggedAt: null };
      pushBounded(s.formSessions, fsn, false);
    }
    fsn.partial = { ...fsn.partial, ...data.partial };
    fsn.lastSeenAt = new Date();
    if (data.formName) fsn.formName = data.formName;
    if (data.pageUrl) fsn.pageUrl = data.pageUrl;
    return fsn;
  },

  async listAbandonedFormSessions(tenantId, idleBefore, limit = 100) {
    return store()
      .formSessions.filter((f) => f.tenantId === tenantId && !f.submittedAt && !f.flaggedAt && f.lastSeenAt < idleBefore && (typeof f.partial.email === "string" || typeof f.partial.phone === "string"))
      .slice(0, limit);
  },

  async updateFormSession(tenantId, sessionKey, patch) {
    const f = store().formSessions.find((x) => x.tenantId === tenantId && x.sessionKey === sessionKey);
    if (f) Object.assign(f, patch);
  },

  async listConversationsAwaitingReply(tenantId, opts) {
    const channels = new Set(opts.channels);
    return store()
      .conversations.filter((c) => c.tenantId === tenantId && c.awaitingReply && channels.has(c.channel) && c.lastMessageAt !== null && c.lastMessageAt < opts.olderThan)
      .slice(0, opts.limit ?? 100);
  },

  async findContactById(tenantId, contactId) {
    return store().contacts.find((c) => c.id === contactId && c.tenantId === tenantId) ?? null;
  },

  async listLapsedCandidates(tenantId, inactiveBefore, limit = 100) {
    const s = store();
    const customerIds = new Set([
      ...s.leads.filter((l) => l.tenantId === tenantId && l.status === "WON" && l.contactId).map((l) => l.contactId!),
      ...s.transactions.filter((t) => t.tenantId === tenantId && t.status === "COMPLETED" && t.contactId).map((t) => t.contactId!),
      ...s.contacts.filter((c) => c.tenantId === tenantId && c.tags.includes("customer")).map((c) => c.id),
    ]);
    const recentlyActive = new Set([
      ...s.transactions.filter((t) => t.tenantId === tenantId && t.status === "COMPLETED" && t.contactId && t.occurredAt >= inactiveBefore).map((t) => t.contactId!),
      ...s.bookings.filter((b) => b.tenantId === tenantId && b.status === "COMPLETED" && b.startsAt && b.startsAt >= inactiveBefore).map((b) => s.leads.find((l) => l.id === b.leadId)?.contactId).filter((x): x is string => Boolean(x)),
    ]);
    return s.contacts.filter((c) => c.tenantId === tenantId && customerIds.has(c.id) && !recentlyActive.has(c.id) && !c.lapsedAt && c.lastActivityAt !== null && c.lastActivityAt < inactiveBefore).slice(0, limit);
  },

  async markContactLapsed(tenantId, contactId, at) {
    const c = store().contacts.find((x) => x.id === contactId && x.tenantId === tenantId);
    if (c) c.lapsedAt = at;
  },

  async setContactConsent(tenantId, contactId, channel, granted, source) {
    const c = store().contacts.find((x) => x.id === contactId && x.tenantId === tenantId);
    if (c) c.consent = { ...c.consent, [channel]: { granted, at: new Date().toISOString(), source } };
  },

  async listLeadsQuietInStage(tenantId, now) {
    const stages = new Map((demoConfig[tenantId]?.pipelines ?? []).flatMap((p) => p.stages.map((s) => [s.id, s])));
    const out: { lead: LeadRecord; stageName: string; quietDays: number }[] = [];
    for (const lead of store().leads) {
      if (lead.tenantId !== tenantId || !lead.stageId || lead.status === "WON" || lead.status === "LOST" || lead.status === "ARCHIVED") continue;
      const stage = stages.get(lead.stageId);
      if (!stage?.quietAfterDays) continue;
      const since = Math.max(lead.stageEnteredAt?.getTime() ?? 0, lead.lastActivityAt?.getTime() ?? 0, lead.createdAt.getTime());
      const quietDays = (now.getTime() - since) / 86_400_000;
      if (quietDays >= stage.quietAfterDays) out.push({ lead, stageName: stage.name, quietDays: Math.floor(quietDays) });
    }
    return out;
  },

  async touchLead(tenantId, leadId, at) {
    const lead = store().leads.find((l) => l.id === leadId && l.tenantId === tenantId);
    if (lead) lead.lastActivityAt = at;
  },

  async upsertMissedOpportunity(tenantId, data: NewMissedOpportunity) {
    assertLeadInTenant(tenantId, data.leadId);
    assertContactInTenant(tenantId, data.contactId);
    const existing = store().missed.find((m) => m.tenantId === tenantId && m.dedupeKey === data.dedupeKey);
    if (existing && OPEN_MISSED.has(existing.status)) return { record: existing, created: false };
    if (existing) {
      if ((existing.resolvedAt ?? existing.detectedAt).getTime() > Date.now() - SNOOZE_MS) return { record: existing, created: false };
      Object.assign(existing, { status: "DETECTED", summary: data.summary, estimatedValueCents: data.estimatedValueCents, detectedAt: new Date(), resolvedAt: null });
      return { record: existing, created: true };
    }
    const record: MissedOpportunityRecord = {
      dedupeKey: data.dedupeKey,
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
    if (status === "RECOVERED" || status === "EXPIRED") {
      m.resolvedAt = new Date();
      const ex = store().exceptions.find((e) => e.tenantId === tenantId && e.missedOpportunityId === m.id && (e.status === "OPEN" || e.status === "IN_PROGRESS"));
      if (ex) ex.status = "RESOLVED";
    }
    if (recoveredValueCents !== undefined) m.recoveredValueCents = recoveredValueCents;
    return m;
  },

  async resolveMissedOpportunityByKey(tenantId, dedupeKey, status, recoveredValueCents) {
    const m = store().missed.find((x) => x.tenantId === tenantId && x.dedupeKey === dedupeKey && OPEN_MISSED.has(x.status));
    return m ? this.resolveMissedOpportunity(tenantId, m.id, status, recoveredValueCents ?? (status === "RECOVERED" ? m.estimatedValueCents : 0)) : null;
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

  async updateAutomationRun(tenantId, runId, patch) {
    const run = store().runs.find((r) => r.id === runId && r.tenantId === tenantId);
    if (run) Object.assign(run, { outcome: patch.outcome, summary: patch.summary });
  },

  async listAutomationRuns(tenantId, limit = 50) {
    return store().runs.filter((r) => r.tenantId === tenantId).sort(byNewest).slice(0, limit);
  },

  async createException(tenantId, data) {
    assertLeadInTenant(tenantId, data.leadId);
    assertContactInTenant(tenantId, data.contactId);
    if (data.missedOpportunityId) {
      const prior = store().exceptions.find((e) => e.tenantId === tenantId && e.missedOpportunityId === data.missedOpportunityId);
      if (prior) {
        Object.assign(prior, { reason: data.reason, suggestedAction: data.suggestedAction ?? null, confidence: data.confidence ?? null, status: "OPEN", escalatedToUserId: data.escalatedToUserId ?? prior.escalatedToUserId, createdAt: new Date() });
        return prior;
      }
    }
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
    const all = s.assets.filter((a) => a.tenantId === tenantId).sort(byNewest);
    const channels = s.channels.filter((c) => c.tenantId === tenantId && c.isActive);
    return {
      assets: all.filter((a) => !SOURCE_KIND_SET.has(a.kind)),
      sources: all.filter((a) => SOURCE_KIND_SET.has(a.kind)),
      posts: s.posts.filter((p) => p.tenantId === tenantId).sort((a, b) => (b.scheduledFor?.getTime() ?? 0) - (a.scheduledFor?.getTime() ?? 0)),
      channels,
      connectedPlatforms: Array.from(new Set(channels.map((c) => c.platform))),
    };
  },

  async createContentAssets(tenantId, items: NewContentAsset[]) {
    const created: ContentAssetRecord[] = items.map((item) => ({
      id: id("asset"),
      tenantId,
      parentId: item.parentId ?? null,
      kind: item.kind,
      title: item.title,
      body: item.body,
      targetPlatform: item.targetPlatform,
      status: item.status,
      needsClientSignoff: item.needsClientSignoff,
      fileUrl: item.fileUrl ?? null,
      tags: item.tags ?? [],
      scheduledFor: item.scheduledFor ?? null,
      generation: item.generation ?? {},
      rejectionNote: null,
      approvedAt: null,
      createdAt: new Date(),
    }));
    for (const asset of created) pushBounded(store().assets, asset);
    return created;
  },

  async listContentAssets(tenantId, opts = {}) {
    const statuses = opts.status ? new Set(opts.status) : null;
    const kinds = opts.kinds ? new Set(opts.kinds) : null;
    return store()
      .assets.filter((a) => a.tenantId === tenantId && (!statuses || statuses.has(a.status)) && (!kinds || kinds.has(a.kind)) && (opts.parentId === undefined || a.parentId === opts.parentId))
      .sort(byNewest)
      .slice(0, opts.limit ?? 100);
  },

  async updateContentAsset(tenantId, assetId, patch) {
    const asset = store().assets.find((a) => a.id === assetId && a.tenantId === tenantId);
    if (!asset) return null;
    Object.assign(asset, patch);
    if (patch.status === "APPROVED") asset.approvedAt = new Date();
    return asset;
  },

  // --- social --------------------------------------------------------------------

  async listChannels(tenantId, opts = {}) {
    return store().channels.filter((c) => c.tenantId === tenantId && (!opts.activeOnly || c.isActive));
  },

  async upsertChannel(tenantId, data) {
    const existing = store().channels.find((c) => c.tenantId === tenantId && c.platform === data.platform && c.externalAccountId === data.externalAccountId);
    if (existing) {
      Object.assign(existing, { displayName: data.displayName ?? existing.displayName, integrationId: data.integrationId ?? existing.integrationId, isActive: data.isActive ?? existing.isActive, settings: { ...existing.settings, ...(data.settings ?? {}) } });
      return existing;
    }
    const channel: ChannelRecord = { id: id("ch"), tenantId, integrationId: data.integrationId ?? null, platform: data.platform, externalAccountId: data.externalAccountId, displayName: data.displayName ?? null, isActive: data.isActive ?? true, settings: data.settings ?? {} };
    store().channels.push(channel);
    return channel;
  },

  async createSocialPosts(tenantId, items: NewSocialPost[]) {
    const created: SocialPostRecord[] = items.map((p) => ({
      id: id("post"),
      tenantId,
      channelId: p.channelId,
      contentAssetId: p.contentAssetId,
      platform: p.platform,
      caption: p.caption,
      mediaUrls: p.mediaUrls ?? [],
      tags: p.tags ?? [],
      status: p.status,
      scheduledFor: p.scheduledFor,
      publishedAt: null,
      externalPostId: null,
      permalink: null,
      errorMessage: null,
      attempts: 0,
      metrics: {},
      batchId: p.batchId ?? null,
      createdAt: new Date(),
    }));
    for (const p of created) pushBounded(store().posts, p);
    return created;
  },

  async listSocialPosts(tenantId, opts = {}) {
    const statuses = opts.status ? new Set(opts.status) : null;
    return store()
      .posts.filter((p) => p.tenantId === tenantId && (!statuses || statuses.has(p.status)) && (!opts.from || (p.scheduledFor && p.scheduledFor >= opts.from)) && (!opts.to || (p.scheduledFor && p.scheduledFor < opts.to)))
      .sort((a, b) => (a.scheduledFor?.getTime() ?? 0) - (b.scheduledFor?.getTime() ?? 0))
      .slice(0, opts.limit ?? 200);
  },

  async findSocialPostById(tenantId, postId) {
    return store().posts.find((p) => p.id === postId && p.tenantId === tenantId) ?? null;
  },

  async updateSocialPost(tenantId, postId, patch) {
    const p = store().posts.find((x) => x.id === postId && x.tenantId === tenantId);
    if (!p) return null;
    Object.assign(p, patch);
    if (patch.status && patch.status !== "PUBLISHING") p.lockedAt = null;
    return p;
  },

  async listDueSocialPosts(now, limit = 50) {
    return store()
      .posts.filter((p) => p.scheduledFor && p.scheduledFor <= now && (p.status === "SCHEDULED" || (p.status === "PUBLISHING" && p.lockedAt && now.getTime() - p.lockedAt.getTime() > 10 * 60_000)))
      .sort((a, b) => a.scheduledFor!.getTime() - b.scheduledFor!.getTime())
      .slice(0, limit);
  },

  async claimSocialPost(postId, now, leaseMs) {
    const p = store().posts.find((x) => x.id === postId);
    if (!p) return false;
    const stale = p.status === "PUBLISHING" && p.lockedAt && now.getTime() - p.lockedAt.getTime() > leaseMs;
    if (p.status !== "SCHEDULED" && !stale) return false;
    p.status = "PUBLISHING";
    p.lockedAt = now;
    return true;
  },

  async recordChannelMetrics(tenantId, data) {
    const s = store();
    const dateKey = data.date.toISOString().slice(0, 10);
    const existing = s.channelMetrics.find((m) => m.channelId === data.channelId && m.date.toISOString().slice(0, 10) === dateKey);
    const row: ChannelMetricSnapshotRecord = { id: existing?.id ?? id("cm"), tenantId, channelId: data.channelId, platform: data.platform, date: new Date(`${dateKey}T00:00:00Z`), followers: data.followers ?? null, reach: data.reach ?? null, impressions: data.impressions ?? null, engagements: data.engagements ?? null, clicks: data.clicks ?? null, posts: data.posts ?? null };
    if (existing) Object.assign(existing, row);
    else pushBounded(s.channelMetrics, row, false);
  },

  async listChannelMetrics(tenantId, opts) {
    return store()
      .channelMetrics.filter((m) => m.tenantId === tenantId && m.date >= opts.since && (!opts.channelId || m.channelId === opts.channelId))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  },

  async upsertSocialConversation(tenantId, data) {
    const s = store();
    const existing = s.conversations.find((c) => c.tenantId === tenantId && c.channel === data.channel && c.externalId === data.externalId);
    if (existing) return { record: existing, created: false };
    const convo: ConversationRecord = { id: id("cv"), tenantId, contactId: data.contactId ?? null, channel: data.channel, externalId: data.externalId, lastMessageAt: null, awaitingReply: false, platform: data.platform, channelId: data.channelId, meta: data.meta ?? {}, displayName: data.displayName, suggestedReply: null };
    pushBounded(s.conversations, convo, false);
    return { record: convo, created: true };
  },

  async listInboxConversations(tenantId, opts = {}) {
    return store()
      .conversations.filter((c) => c.tenantId === tenantId && (c.channel === "SOCIAL_DM" || c.channel === "SOCIAL_COMMENT") && (!opts.awaitingOnly || c.awaitingReply))
      .sort((a, b) => (b.lastMessageAt?.getTime() ?? 0) - (a.lastMessageAt?.getTime() ?? 0))
      .slice(0, opts.limit ?? 100);
  },

  async findConversationById(tenantId, conversationId) {
    return store().conversations.find((c) => c.id === conversationId && c.tenantId === tenantId) ?? null;
  },

  async listMessages(tenantId, conversationId, limit = 50) {
    return store()
      .messages.filter((m) => m.tenantId === tenantId && m.conversationId === conversationId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(-limit)
      .map((m): MessageRecord => ({ id: m.id, tenantId: m.tenantId, conversationId: m.conversationId, direction: m.direction, sender: m.sender, body: m.body, status: m.status, providerMessageId: m.providerMessageId ?? null, createdAt: m.createdAt }));
  },

  async hasMessageWithProviderId(tenantId, conversationId, providerMessageId) {
    return store().messages.some((m) => m.tenantId === tenantId && m.conversationId === conversationId && m.providerMessageId === providerMessageId);
  },

  async updateConversation(tenantId, conversationId, patch) {
    const c = store().conversations.find((x) => x.id === conversationId && x.tenantId === tenantId);
    if (!c) return;
    if (patch.awaitingReply !== undefined) c.awaitingReply = patch.awaitingReply;
    if (patch.suggestedReply !== undefined) c.suggestedReply = patch.suggestedReply;
    if (patch.meta) c.meta = { ...(c.meta ?? {}), ...patch.meta };
  },

  async findContentAssetById(tenantId, assetId) {
    return store().assets.find((a) => a.id === assetId && a.tenantId === tenantId) ?? null;
  },

  async updateContentAssetStatus(tenantId, assetId, status, note) {
    const asset = store().assets.find((a) => a.id === assetId && a.tenantId === tenantId);
    if (!asset) return null;
    asset.status = status;
    asset.rejectionNote = status === "REJECTED" ? (note ?? null) : null;
    if (status === "APPROVED") asset.approvedAt = new Date();
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
