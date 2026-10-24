import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { repository } from "@/lib/data";
import { emit } from "@/lib/events";
import { startOfMonthInZone } from "@/lib/utils";
import type { AdAccountRecord, AdPlatform, TenantSummary } from "@/lib/types";
import { adsProviderFor, hasRealAdsProvider, type AdsCredentials } from "./providers";
import { registerBuiltInAdsProviders } from "./providers/builtin";

registerBuiltInAdsProviders();

/**
 * Ad spend: pulled daily per connected account, stored per campaign per day,
 * and compared with the tenant's monthly budget for pacing. Credentials sit
 * encrypted on the ad account row (bound to its id) and are never logged.
 */

export async function connectAdAccount(tenant: TenantSummary, input: { platform: AdPlatform; externalAccountId: string; name?: string | null; monthlyBudgetCents?: number | null; creds: AdsCredentials }): Promise<AdAccountRecord> {
  const account = await repository.upsertAdAccount(tenant.id, { platform: input.platform, externalAccountId: input.externalAccountId, name: input.name ?? null, currency: tenant.currency, monthlyBudgetCents: input.monthlyBudgetCents ?? null });
  await repository.upsertAdAccount(tenant.id, { platform: input.platform, externalAccountId: input.externalAccountId, settings: { credentialsEnc: encryptSecret(JSON.stringify(input.creds), account.id) } });
  const provider = adsProviderFor(input.platform);
  if (provider.fetchAccount && hasRealAdsProvider(input.platform)) {
    const info = await provider.fetchAccount({ ...account, settings: {} }, input.creds);
    if (info.ok) await repository.upsertAdAccount(tenant.id, { platform: input.platform, externalAccountId: input.externalAccountId, name: input.name ?? info.data.name ?? null, currency: info.data.currency ?? tenant.currency });
  }
  return (await repository.listAdAccounts(tenant.id)).find((a) => a.id === account.id) ?? account;
}

export function loadAdsCredentials(account: AdAccountRecord): AdsCredentials | null {
  const enc = account.settings.credentialsEnc;
  if (typeof enc !== "string") return null;
  try {
    return JSON.parse(decryptSecret(enc, account.id)) as AdsCredentials;
  } catch (error) {
    console.error(`[ads] could not read credentials for ${account.platform} ${account.externalAccountId}: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/** Pulls the last days of spend for every active account. */
export async function syncAdSpend(tenant: TenantSummary, now = new Date()): Promise<{ accounts: number; rows: number }> {
  let rows = 0;
  const accounts = await repository.listAdAccounts(tenant.id, { activeOnly: true });
  for (const account of accounts) {
    const provider = adsProviderFor(account.platform);
    const real = hasRealAdsProvider(account.platform);
    let creds = real ? loadAdsCredentials(account) : { accessToken: "" };
    if (!creds) {
      await repository.updateAdAccount(tenant.id, account.id, { lastError: "No credentials on file; reconnect the account." });
      continue;
    }
    if (real && provider.refreshCredentials && creds.expiresAt && new Date(creds.expiresAt).getTime() < now.getTime() + 5 * 60_000) {
      const fresh = await provider.refreshCredentials(creds).catch(() => null);
      if (fresh) {
        creds = fresh;
        await repository.upsertAdAccount(tenant.id, { platform: account.platform, externalAccountId: account.externalAccountId, settings: { credentialsEnc: encryptSecret(JSON.stringify(fresh), account.id) } });
      }
    }
    // Re-read a few days back so late-attributed conversions and currency adjustments settle.
    const from = new Date(Math.max((account.lastSyncAt?.getTime() ?? 0) - 3 * 86_400_000, now.getTime() - 30 * 86_400_000));
    const result = await provider.fetchDailySpend(account, creds, { from, to: now });
    if (!result.ok) {
      await repository.updateAdAccount(tenant.id, account.id, { lastError: result.error });
      if (!result.retryable) await repository.createException(tenant.id, { reason: `Ad spend for ${account.name ?? account.externalAccountId} could not be read: ${result.error}`, suggestedAction: "Reconnect the ad account in the console.", confidence: 0.9 });
      continue;
    }
    rows += await repository.recordAdSpend(
      tenant.id,
      result.data.map((r) => ({ adAccountId: account.id, platform: account.platform, date: new Date(`${r.date}T00:00:00Z`), campaignId: r.campaignId, campaignName: r.campaignName, spendCents: r.spendCents, impressions: r.impressions, clicks: r.clicks, platformLeads: r.leads })),
    );
    await repository.updateAdAccount(tenant.id, account.id, { lastSyncAt: now, lastError: null });
  }
  return { accounts: accounts.length, rows };
}

export interface PacingStatus {
  budgetCents: number;
  spentCents: number;
  expectedCents: number;
  /** Positive when ahead of plan, negative when behind, as a fraction of expected. */
  driftPct: number | null;
  daysElapsed: number;
  daysInMonth: number;
  /** Where the month ends up at this rate. */
  projectedCents: number;
}

export async function pacingStatus(tenant: TenantSummary, now = new Date()): Promise<PacingStatus | null> {
  const accounts = await repository.listAdAccounts(tenant.id, { activeOnly: true });
  const budgetCents = accounts.reduce((sum, a) => sum + (a.monthlyBudgetCents ?? 0), 0);
  if (budgetCents === 0) return null;
  const monthStart = startOfMonthInZone(tenant.timezone, now);
  const spentCents = await repository.sumAdSpend(tenant.id, monthStart);
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed = Math.max(1, Math.min(daysInMonth, Math.floor((now.getTime() - monthStart.getTime()) / 86_400_000) + 1));
  const expectedCents = Math.round((budgetCents * daysElapsed) / daysInMonth);
  const driftPct = expectedCents > 0 ? Math.round(((spentCents - expectedCents) / expectedCents) * 100) : null;
  const projectedCents = Math.round((spentCents / daysElapsed) * daysInMonth);
  return { budgetCents, spentCents, expectedCents, driftPct, daysElapsed, daysInMonth, projectedCents };
}

/** Raises one pacing exception per tenant per month-direction when spend drifts past the threshold. */
export async function checkPacing(tenant: TenantSummary, now = new Date()): Promise<PacingStatus | null> {
  const status = await pacingStatus(tenant, now);
  if (!status || status.driftPct === null || status.daysElapsed < 3) return status;
  const cfg = await repository.getTenantConfig(tenant.id);
  const settings = cfg.automations.find((a) => a.typeKey === "ads_sync")?.settings ?? {};
  const threshold = typeof settings.pacingDriftPct === "number" ? settings.pacingDriftPct : 25;
  if (Math.abs(status.driftPct) < threshold) return status;
  const direction = status.driftPct > 0 ? "over" : "under";
  const open = await repository.listExceptions([tenant.id]);
  if (open.some((e) => e.reason.includes(`running ${direction} budget`))) return status;
  const money = (c: number) => (c / 100).toLocaleString(tenant.locale, { style: "currency", currency: tenant.currency, maximumFractionDigits: 0 });
  await repository.createException(tenant.id, {
    reason: `Ad spend at ${tenant.name} is running ${direction} budget: ${money(status.spentCents)} spent by day ${status.daysElapsed} of ${status.daysInMonth} against ${money(status.budgetCents)} planned (${status.driftPct > 0 ? "+" : ""}${status.driftPct}%), heading for ${money(status.projectedCents)}.`,
    suggestedAction: direction === "over" ? "Check for a campaign that escaped its daily cap, or agree a higher budget with the client." : "Check for paused or disapproved campaigns, or lower the plan so the numbers tell the truth.",
    confidence: 0.8,
  });
  await repository.recordAutomationRun(tenant.id, { typeKey: "ads_sync", outcome: "ESCALATED", summary: `Ad spend is running ${direction} budget this month (${status.driftPct > 0 ? "+" : ""}${status.driftPct}%); we've flagged it for a person.` });
  await emit(tenant.id, "ads.pacing_alert", { direction, driftPct: status.driftPct, spentCents: status.spentCents, budgetCents: status.budgetCents });
  return status;
}

/** The daily job: sync, then check pacing. */
export async function runAdsSync(tenant: TenantSummary, now = new Date()) {
  const cfg = await repository.getTenantConfig(tenant.id);
  const enabled = cfg.automations.find((a) => a.typeKey === "ads_sync")?.enabled && cfg.modules.find((m) => m.moduleKey === "ads")?.enabled !== false;
  if (!enabled) return { accounts: 0, rows: 0, pacing: null };
  const sync = await syncAdSpend(tenant, now);
  const pacing = await checkPacing(tenant, now);
  if (sync.rows) await repository.recordAutomationRun(tenant.id, { typeKey: "ads_sync", outcome: "COMPLETED", summary: `Updated ad spend from ${sync.accounts} account${sync.accounts === 1 ? "" : "s"}.` });
  return { ...sync, pacing };
}
