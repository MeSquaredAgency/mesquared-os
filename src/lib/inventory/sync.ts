import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { repository } from "@/lib/data";
import type { TenantSummary } from "@/lib/types";
import { importInventory } from "./index";
import { INVENTORY_VENDORS, inventoryProviderFor, type InventoryCredentials, type InventoryVendor } from "./providers";

/**
 * The daily listings sync: the PROPERTY_MANAGEMENT integration names the
 * vendor in its settings and holds the encrypted token; the provider pulls the
 * rent roll and vacancies and `importInventory` upserts them, which in turn
 * makes new active listings content material and keeps the listing-aware
 * enquiry reply current.
 */

export interface InventoryConnection {
  integrationId: string;
  vendor: InventoryVendor;
  creds: InventoryCredentials;
  externalAccountId: string;
}

export async function loadInventoryConnection(tenantId: string): Promise<InventoryConnection | null> {
  const integration = await repository.findIntegration(tenantId, "PROPERTY_MANAGEMENT");
  if (!integration?.credentialsEnc || integration.status !== "CONNECTED") return null;
  const vendor = String(integration.settings.vendor ?? "").toLowerCase();
  if (!(INVENTORY_VENDORS as readonly string[]).includes(vendor)) return null;
  try {
    return { integrationId: integration.id, vendor: vendor as InventoryVendor, creds: JSON.parse(decryptSecret(integration.credentialsEnc, integration.id)) as InventoryCredentials, externalAccountId: integration.externalAccountId ?? "" };
  } catch (error) {
    console.error(`[inventory] could not read ${vendor} credentials: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/** Stores the vendor token encrypted on the tenant's PROPERTY_MANAGEMENT integration row. */
export async function connectInventoryVendor(tenantId: string, vendor: InventoryVendor, creds: InventoryCredentials, opts: { externalAccountId?: string; label?: string | null } = {}) {
  // Integration rows are unique on (provider, externalAccountId) across the platform, so the default is per tenant.
  const externalAccountId = opts.externalAccountId ?? `${vendor}:${tenantId}`;
  const existing = await repository.findIntegration(tenantId, "PROPERTY_MANAGEMENT");
  const row = existing ?? (await repository.upsertIntegration(tenantId, { provider: "PROPERTY_MANAGEMENT", externalAccountId, label: opts.label ?? null, status: "PENDING", settings: { vendor } }));
  await repository.upsertIntegration(tenantId, { provider: "PROPERTY_MANAGEMENT", externalAccountId, label: opts.label ?? null, status: "CONNECTED", settings: { ...(existing?.settings ?? {}), vendor }, credentialsEnc: encryptSecret(JSON.stringify(creds), row.id), lastError: null });
}

export async function runInventorySync(tenant: TenantSummary, now = new Date()): Promise<{ created: number; updated: number; skipped: string | null }> {
  const config = await repository.getTenantConfig(tenant.id);
  if (!config.modules.find((m) => m.moduleKey === "inventory")?.enabled) return { created: 0, updated: 0, skipped: "inventory module off" };
  if (!config.automations.find((a) => a.typeKey === "inventory_sync")?.enabled) return { created: 0, updated: 0, skipped: "listings sync off" };
  const connection = await loadInventoryConnection(tenant.id);
  if (!connection) return { created: 0, updated: 0, skipped: "no property management software connected" };
  const provider = inventoryProviderFor(connection.vendor);
  const result = await provider.fetchListings(connection.creds, { currency: tenant.currency });
  if (!result.ok) {
    await repository.upsertIntegration(tenant.id, { provider: "PROPERTY_MANAGEMENT", externalAccountId: connection.externalAccountId, status: "NEEDS_ATTENTION", lastError: result.error });
    await repository.recordAutomationRun(tenant.id, { typeKey: "inventory_sync", outcome: "FAILED", summary: `Couldn't read listings from ${connection.vendor}: ${result.error}` });
    return { created: 0, updated: 0, skipped: result.error };
  }
  if (result.credentials) {
    await repository.upsertIntegration(tenant.id, { provider: "PROPERTY_MANAGEMENT", externalAccountId: connection.externalAccountId, status: "CONNECTED", credentialsEnc: encryptSecret(JSON.stringify(result.credentials), connection.integrationId), lastError: null });
  }
  const imported = await importInventory(tenant, result.items, connection.vendor);
  await repository.upsertIntegration(tenant.id, { provider: "PROPERTY_MANAGEMENT", externalAccountId: connection.externalAccountId, status: "CONNECTED", lastSyncAt: now, lastError: null });
  await repository.recordAutomationRun(tenant.id, { typeKey: "inventory_sync", outcome: "COMPLETED", summary: `Read ${result.items.length} listing${result.items.length === 1 ? "" : "s"} from ${connection.vendor}${result.note ? ` (${result.note})` : ""}: ${imported.created} new, ${imported.updated} changed.` });
  return { ...imported, skipped: null };
}
