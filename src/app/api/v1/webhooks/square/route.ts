import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Square webhooks are per workspace: use /api/v1/webhooks/square/<integrationId> (shown in the console when Square is connected). */
export async function POST() {
  return NextResponse.json({ error: "Use the per-workspace URL /api/v1/webhooks/square/<integrationId>." }, { status: 404 });
}
