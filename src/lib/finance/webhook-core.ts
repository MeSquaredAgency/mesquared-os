import { repository } from "@/lib/data";
import type { ConnectedFinanceProvider, TenantSummary } from "@/lib/types";
import { financeConnectorFor, hasRealFinanceConnector } from "./providers";
import { registerBuiltInFinanceConnectors } from "./providers/builtin";
import { ingestFinanceRows, loadFinanceCredentials } from "./sync";

registerBuiltInFinanceConnectors();

export interface WebhookDecision {
  status: number;
  body: Record<string, unknown>;
}

/**
 * What a provider webhook does, without the HTTP wrapper: an unknown endpoint
 * is 404, a workspace without a secret 503, a bad signature 401, and only
 * then is the body parsed into the ledger. Each tenant has its own URL
 * (/api/v1/webhooks/<provider>/<integrationId>), so the secret is its own.
 */
export async function processFinanceWebhook(input: { raw: string; headers: Record<string, string | null>; url: string; provider: ConnectedFinanceProvider; integrationId: string }): Promise<WebhookDecision> {
  const tenant = await findTenantForIntegration(input.provider, input.integrationId);
  if (!tenant) return { status: 404, body: { error: "Unknown webhook endpoint." } };
  const connector = financeConnectorFor(input.provider);
  if (!hasRealFinanceConnector(input.provider) || !connector.verifyWebhook || !connector.parseWebhook) return { status: 200, body: { received: true, ignored: "no connector for this provider in this deployment" } };
  const loaded = await loadFinanceCredentials(tenant.id, input.provider);
  const secret = loaded?.creds.webhookSecret;
  if (!secret) return { status: 503, body: { error: "No webhook secret on file for this workspace." } };
  if (!connector.verifyWebhook(input.raw, input.headers, secret, input.url)) return { status: 401, body: { error: "Bad signature." } };
  let body: unknown;
  try {
    body = JSON.parse(input.raw);
  } catch {
    return { status: 400, body: { error: "Body must be JSON." } };
  }
  const parsed = connector.parseWebhook(body);
  const result = await ingestFinanceRows(tenant, input.provider, parsed);
  return { status: 200, body: { received: true, transactions: result.transactions, invoices: result.invoices } };
}

async function findTenantForIntegration(provider: ConnectedFinanceProvider, integrationId: string): Promise<TenantSummary | null> {
  // One lookup by the integration's own id: Stripe and Square send a webhook per payment, so this must not grow with the portfolio.
  return repository.findTenantByIntegrationId(provider, integrationId);
}
