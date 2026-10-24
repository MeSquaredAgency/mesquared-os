/**
 * Neon Function "ops": runs next to the database on the linked branch.
 *
 *   GET  /      Database-backed status (active tenants, due scheduled work, open
 *               exceptions) for uptime checks that should not depend on the app host.
 *   POST /tick  Target of the "tick-every-minute" schedule trigger. Verifies the
 *               delivery came from Neon, then forwards one scheduler tick to the
 *               app (POST /api/jobs/tick with JOB_SECRET) when APP_URL and
 *               JOB_SECRET were uploaded with `neon deploy --env .env`.
 *
 * DATABASE_URL (pooled) and NEON_BRANCH are injected by Neon at runtime.
 */
import { Hono } from "hono";
import { Pool } from "pg";
import { attachDatabasePool } from "@neon/functions";
import { parseTriggerDelivery } from "@neon/functions/triggers";

// One pool per isolate, reused across requests; keep it small because isolates scale out.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
attachDatabasePool(pool);

interface StatusRow {
  activeTenants: number;
  dueActions: number;
  openExceptions: number;
  leadsLast24h: number;
  lastActionRanAt: Date | null;
}

// Prisma keeps model and column names as written, hence the quoted identifiers.
const STATUS_SQL = `
  SELECT
    (SELECT count(*)::int FROM "Tenant" WHERE "isActive") AS "activeTenants",
    (SELECT count(*)::int FROM "ScheduledAction" WHERE status = 'PENDING' AND "runAt" <= now()) AS "dueActions",
    (SELECT count(*)::int FROM "ExceptionItem" WHERE status = 'OPEN') AS "openExceptions",
    (SELECT count(*)::int FROM "Lead" WHERE "createdAt" >= now() - interval '24 hours') AS "leadsLast24h",
    (SELECT max("ranAt") FROM "ScheduledAction") AS "lastActionRanAt"
`;

const app = new Hono();

app.get("/", async (c) => {
  const { rows } = await pool.query<StatusRow>(STATUS_SQL);
  const row = rows[0];
  return c.json({
    status: "ok",
    service: "mesquared-os-ops",
    branch: process.env.NEON_BRANCH ?? null,
    tickForwarding: Boolean(process.env.APP_URL && process.env.JOB_SECRET),
    database: {
      activeTenants: row.activeTenants,
      dueActions: row.dueActions,
      openExceptions: row.openExceptions,
      leadsLast24h: row.leadsLast24h,
      lastActionRanAt: row.lastActionRanAt ? new Date(row.lastActionRanAt).toISOString() : null,
    },
    time: new Date().toISOString(),
  });
});

app.post("/tick", async (c) => {
  // Neon strips client-supplied x-neon-* headers, so a valid delivery can only come from a trigger.
  const delivery = await parseTriggerDelivery(c.req.raw);
  if (!delivery.ok) return c.json({ error: `Not a trigger delivery (${delivery.error}).` }, 401);
  const scheduledAt = delivery.invocation.type === "schedule" ? delivery.invocation.data.scheduledAt : null;

  const appUrl = process.env.APP_URL;
  const secret = process.env.JOB_SECRET;
  if (!appUrl || !secret) {
    console.log(JSON.stringify({ event: "tick.skipped", reason: "APP_URL and JOB_SECRET are not configured on this function", scheduledAt }));
    return c.json({ forwarded: false, reason: "APP_URL and JOB_SECRET are not configured on this function.", scheduledAt });
  }

  let status = 0;
  let body: unknown = null;
  try {
    const res = await fetch(new URL("/api/jobs/tick", appUrl), {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(120_000),
    });
    status = res.status;
    const text = await res.text();
    try {
      body = JSON.parse(text);
    } catch {
      body = text.slice(0, 500);
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "tick.failed", scheduledAt, error: error instanceof Error ? error.message : String(error) }));
    return c.json({ forwarded: false, reason: "The app did not answer.", scheduledAt }, 502);
  }
  console.log(JSON.stringify({ event: "tick.forwarded", status, scheduledAt }));
  return c.json({ forwarded: true, status, scheduledAt, result: body }, status >= 200 && status < 300 ? 200 : 502);
});

export default app;
