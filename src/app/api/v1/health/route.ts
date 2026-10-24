import { NextResponse } from "next/server";
import { dataMode } from "@/lib/data";
import { neonServices } from "@/lib/neon";
import { qualifierEngine } from "@/lib/qualify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness probe for deploys and uptime checks. Reports mode and which services are wired, never secrets. */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "mesquared-os",
    dataMode,
    qualifier: qualifierEngine(),
    services: neonServices(),
    time: new Date().toISOString(),
  });
}
