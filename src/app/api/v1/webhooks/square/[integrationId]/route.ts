import type { NextRequest } from "next/server";
import { handleFinanceWebhook } from "@/lib/finance/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/v1/webhooks/square/<integrationId> — Square payment and invoice events for one workspace. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ integrationId: string }> }) {
  const { integrationId } = await params;
  return handleFinanceWebhook(req, "SQUARE", integrationId);
}
