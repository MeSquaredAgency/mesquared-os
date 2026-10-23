import { NextResponse } from "next/server";
import { dataMode } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness probe for deploys and uptime checks. Reports mode, never secrets. */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "mesquared-os",
    dataMode,
    time: new Date().toISOString(),
  });
}
