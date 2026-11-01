import { NextResponse } from "next/server";
import { dataMode, repository } from "@/lib/data";
import { neonServices } from "@/lib/neon";
import { qualifierEngine } from "@/lib/qualify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How old the scheduler's last tick may be before the deployment counts as unhealthy. */
const TICK_FRESH_MS = 5 * 60_000;
/** A due step older than this means the scheduler is alive but not keeping up. */
const BACKLOG_STALE_SECONDS = 10 * 60;

/**
 * Health for deploys and uptime checks: 200 when the database answers, the
 * scheduler has ticked recently and the queue is keeping up; 503 otherwise.
 * Reports mode, the queue backlog and which services are wired, never secrets.
 */
export async function GET() {
  const now = new Date();
  const [database, lastTickAt, backlog] = await Promise.all([
    repository.ping().catch(() => false),
    repository.getHeartbeat("tick").catch(() => null),
    repository.schedulerBacklog(now).catch(() => null),
  ]);
  const tickAgeSeconds = lastTickAt ? Math.round((now.getTime() - lastTickAt.getTime()) / 1000) : null;
  // In demo mode nothing schedules the tick, so only the database answer counts there.
  const scheduled = dataMode === "postgres";
  const tickFresh = !scheduled || (tickAgeSeconds !== null && tickAgeSeconds * 1000 < TICK_FRESH_MS);
  const keepingUp = !scheduled || backlog === null || backlog.oldestDueAgeSeconds === null || backlog.oldestDueAgeSeconds < BACKLOG_STALE_SECONDS;
  const ok = database && tickFresh && keepingUp;
  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      service: "mesquared-os",
      dataMode,
      database: database ? "ok" : "unreachable",
      scheduler: { lastTickAt: lastTickAt?.toISOString() ?? null, ageSeconds: tickAgeSeconds, fresh: tickFresh },
      queue: backlog ? { ...backlog, keepingUp } : null,
      qualifier: qualifierEngine(),
      services: neonServices(),
      time: now.toISOString(),
    },
    { status: ok ? 200 : 503 },
  );
}
