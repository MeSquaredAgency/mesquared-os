import { NextResponse, type NextRequest } from "next/server";
import { repository } from "@/lib/data";
import type { ConnectedFinanceProvider } from "@/lib/types";
import { financeConnectorFor, hasRealFinanceConnector } from "./providers";
import { registerBuiltInFinanceConnectors } from "./providers/builtin";
import { ingestFinanceRows, loadFinanceCredentials } from "./sync";

registerBuiltInFinanceConnectors();

/**
 * Shared handler for provider webhooks. Each tenant gets its own URL
 * (/api/v1/webhooks/<provider>/<integrationId>) so the signature secret is
 * the tenant's own; an unknown id or a bad signature is refused before any
 * body is parsed into the ledger.
 */
export async function handleFinanceWebhook(req: NextRequest, provider: ConnectedFinanceProvider, integrationId: string): Promise<NextResponse> {
  const raw = await req.text();
  const tenant = await findTenantForIntegration(provider, integrationId);
  if (!tenant) return NextResponse.json({ error: "Unknown webhook endpoint." }, { status: 404 });
  const connector = financeConnectorFor(provider);
  if (!hasRealFinanceConnector(provider) || !connector.verifyWebhook || !connector.parseWebhook) return NextResponse.json({ received: true, ignored: "no connector for this provider in this deployment" }, { status: 202 });
  const loaded = await loadFinanceCredentials(tenant.id, provider);
  const secret = loaded?.creds.webhookSecret;
  if (!secret) return NextResponse.json({ error: "No webhook secret on file for this workspace." }, { status: 503 });
  const headers: Record<string, string | null> = {};
  for (const h of ["x-square-hmacsha256-signature", "stripe-signature"]) headers[h] = req.headers.get(h);
  if (!connector.verifyWebhook(raw, headers, secret, req.url)) return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const parsed = connector.parseWebhook(body);
  const result = await ingestFinanceRows(tenant, provider, parsed);
  return NextResponse.json({ received: true, transactions: result.transactions, invoices: result.invoices });
}

async function findTenantForIntegration(provider: ConnectedFinanceProvider, integrationId: string) {
  // Integrations are per tenant; walk the tenants once (webhooks are rare) rather than add a cross-tenant lookup.
  for (const tenant of await repository.listAllTenants()) {
    const integration = await repository.findIntegration(tenant.id, provider);
    if (integration?.id === integrationId) return tenant;
  }
  return null;
}
