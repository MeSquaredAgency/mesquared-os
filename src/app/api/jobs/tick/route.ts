import { NextResponse, type NextRequest } from "next/server";
import { tick } from "@/lib/jobs/tick";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/jobs/tick — one scheduler tick: missed-opportunity detectors
 * for every tenant, then due scheduled actions. Call it every minute with
 * Authorization: Bearer <JOB_SECRET>.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.JOB_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  return NextResponse.json(await tick());
}
