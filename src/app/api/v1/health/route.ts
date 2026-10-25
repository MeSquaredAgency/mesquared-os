import { NextResponse } from "next/server";
import { dataMode, repository } from "@/lib/data";
import { neonServices } from "@/lib/neon";
import { qualifierEngine } from "@/lib/qualify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How old the scheduler's last tick may be before the deployment counts as unhealthy. */
const TICK_FRESH_MS = 5 * 60_000;

/**
 * Health for deploys and uptime checks: 200 when the database answers, 503
 * when it does not or when the scheduler has not ticked recently. Reports
 * mode and which services are wired, never secrets.
 */
export async function GET() {
  const [database, lastTickAt] = await Promise.all([repository.ping().catch(() => false), repository.getHeartbeat("tick").catch(() => null)]);
  const now = Date.now();
  const tickAgeSeconds = lastTickAt ? Math.round((now - lastTickAt.getTime()) / 1000) : null;
  // In demo mode nothing schedules the tick, so only the database answer counts there.
  const tickFresh = dataMode !== "postgres" || (tickAgeSeconds !== null && tickAgeSeconds * 1000 < TICK_FRESH_MS);
  const ok = database && tickFresh;
  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      service: "mesquared-os",
      dataMode,
      database: database ? "ok" : "unreachable",
      scheduler: { lastTickAt: lastTickAt?.toISOString() ?? null, ageSeconds: tickAgeSeconds, fresh: tickFresh },
      qualifier: qualifierEngine(),
      services: neonServices(),
      time: new Date(now).toISOString(),
    },
    { status: ok ? 200 : 503 },
  );
}
