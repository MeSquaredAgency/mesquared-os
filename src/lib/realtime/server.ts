/**
 * Neon Realtime, server side. Queries are defined and sealed here with
 * NEON_REALTIME_SECRET (never shipped to the browser); the Client Portal
 * subscribes with the sealed query only. Every query is tenant-scoped by
 * parameter, so a sealed query can only ever stream one workspace's rows.
 */
import { createRealtime, rawSql, type RawSqlQuery, type RealtimeServer, type SealedLiveQuery } from "@neon/realtime/server";
import { databaseName, neonServices } from "@/lib/neon";
import { LIVE_LEADS_LIMIT, type LiveLeadRow } from "./leads";

export type { LiveLeadRow } from "./leads";
export { LIVE_LEADS_LIMIT, toLiveLeadRow } from "./leads";

export function isRealtimeConfigured(): boolean {
  return neonServices().realtime;
}

/** WebSocket URL the browser connects to. Not a secret, but only needed where a page subscribes. */
export function realtimeUrl(): string {
  const url = process.env.NEON_REALTIME_URL;
  if (!url) throw new Error("NEON_REALTIME_URL is not set.");
  return url;
}

let server: RealtimeServer<RawSqlQuery<unknown>> | null = null;

export function getRealtime(): RealtimeServer<RawSqlQuery<unknown>> {
  if (!server) {
    const secret = process.env.NEON_REALTIME_SECRET;
    const db = databaseName(process.env.DATABASE_URL);
    if (!secret || !db) throw new Error("Realtime is not configured: NEON_REALTIME_SECRET and DATABASE_URL are required.");
    server = createRealtime({ secret, db });
  }
  return server;
}

export interface LeadScope {
  /** Restrict to this assignee's leads plus unassigned ones (members without VIEW_ALL_RECORDS); null sees everything. */
  onlyAssigneeId: string | null;
}

// Prisma keeps model and column names as written, hence the quoted identifiers.
const LEAD_COLUMNS =
  '"id", "firstName", "lastName", "email", "phone", "company", "message", "source", "status", "ticketType", "intentScore", "qualificationReason", "qualifiedBy", "stageId", "createdAt"';

/** The most recent leads of one tenant, newest first. Same filter as the portal's leads page. */
export function leadsLiveQuery(tenantId: string, scope: LeadScope): RawSqlQuery<LiveLeadRow> {
  if (scope.onlyAssigneeId) {
    return rawSql<LiveLeadRow>(
      `SELECT ${LEAD_COLUMNS} FROM "Lead" WHERE "tenantId" = $1 AND ("assigneeId" = $2 OR "assigneeId" IS NULL) ORDER BY "createdAt" DESC LIMIT ${LIVE_LEADS_LIMIT}`,
      [tenantId, scope.onlyAssigneeId],
    );
  }
  return rawSql<LiveLeadRow>(`SELECT ${LEAD_COLUMNS} FROM "Lead" WHERE "tenantId" = $1 ORDER BY "createdAt" DESC LIMIT ${LIVE_LEADS_LIMIT}`, [tenantId]);
}

/** Seal the lead list for one tenant and scope. Local crypto, no network call; cheap to do per request. */
export function sealLeadsQuery(tenantId: string, scope: LeadScope): Promise<SealedLiveQuery<LiveLeadRow>> {
  return getRealtime().seal({ query: leadsLiveQuery(tenantId, scope) });
}
