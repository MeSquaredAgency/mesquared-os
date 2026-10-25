import { NextResponse, type NextRequest } from "next/server";
import type { ConnectedFinanceProvider } from "@/lib/types";
import { processFinanceWebhook } from "./webhook-core";

/** HTTP wrapper over processFinanceWebhook for the per-provider route handlers. */
export async function handleFinanceWebhook(req: NextRequest, provider: ConnectedFinanceProvider, integrationId: string): Promise<NextResponse> {
  const raw = await req.text();
  const headers: Record<string, string | null> = {};
  for (const h of ["x-square-hmacsha256-signature", "stripe-signature"]) headers[h] = req.headers.get(h);
  const decision = await processFinanceWebhook({ raw, headers, url: req.url, provider, integrationId });
  return NextResponse.json(decision.body, { status: decision.status });
}
