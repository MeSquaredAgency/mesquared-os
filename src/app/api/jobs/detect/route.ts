import { NextResponse, type NextRequest } from "next/server";
import { repository } from "@/lib/data";
import { detectForTenant } from "@/lib/opportunities/detect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/jobs/detect — runs the missed-opportunity detectors for every
 * active tenant. Call it from a scheduler every few minutes with
 * `Authorization: Bearer <JOB_SECRET>`.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.JOB_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  // Platform admins see every active tenant; a job runs with that scope.
  const admin = await repository.findUserByEmail(process.env.JOB_ACTOR_EMAIL ?? "");
  const tenants = admin ? (await repository.listTenantAccess(admin.user.id)).map((a) => a.tenant) : [];
  const results = [];
  for (const tenant of tenants) results.push(await detectForTenant(tenant));
  return NextResponse.json({ ran: results.length, detected: results.reduce((n, r) => n + r.detected.length, 0), results });
}
