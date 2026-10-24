import type { AdPlatform } from "@/lib/types";
import type { AdsProvider } from "./types";

export * from "./types";

const registry = new Map<AdPlatform, AdsProvider>();

/** Simulated ad spend for demos and tests (ADS_MODE=log): a steady daily spend on two campaigns. */
export const logAdsProvider: AdsProvider = {
  name: "log",
  platform: "META",
  async fetchDailySpend(account, _creds, range) {
    const rows = [];
    for (let d = new Date(range.from); d <= range.to; d = new Date(d.getTime() + 86_400_000)) {
      const date = d.toISOString().slice(0, 10);
      rows.push({ date, campaignId: "demo_campaign_1", campaignName: "Landlord leads", spendCents: 2200, impressions: 1800, clicks: 41, leads: 1, currency: account.currency });
      rows.push({ date, campaignId: "demo_campaign_2", campaignName: "Brand", spendCents: 900, impressions: 2600, clicks: 22, leads: 0, currency: account.currency });
    }
    return { ok: true, data: rows };
  },
};

export function registerAdsProvider(provider: AdsProvider) {
  registry.set(provider.platform, provider);
}

export function adsProviderFor(platform: AdPlatform): AdsProvider {
  if (process.env.ADS_MODE === "log") return { ...logAdsProvider, platform };
  return registry.get(platform) ?? { ...logAdsProvider, platform };
}

export function hasRealAdsProvider(platform: AdPlatform): boolean {
  return process.env.ADS_MODE !== "log" && registry.has(platform);
}
