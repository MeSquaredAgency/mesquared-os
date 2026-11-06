import { NextResponse, type NextRequest } from "next/server";
import { runAgentWork } from "@/lib/agents/runtime";
import { safeEqual } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/jobs/agents — steps every agent run that has a step due (see
 * src/lib/agents/runtime.ts). The minute cron calls it beside the tick, so a
 * slow Claude call never holds up detectors or due actions. Authorization:
 * Bearer <JOB_SECRET>. Does nothing while AGENTS_MODE is off.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.JOB_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  return NextResponse.json(await runAgentWork());
}
