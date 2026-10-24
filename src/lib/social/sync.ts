import { repository } from "@/lib/data";
import { emit } from "@/lib/events";
import type { TenantSummary } from "@/lib/types";
import { flagIntegration, loadChannelCredentials } from "./credentials";
import { syncInbox } from "./inbox";
import { syncChannelMetrics } from "./metrics";
import { socialProviderFor } from "./providers";
import { registerBuiltInProviders } from "./providers/builtin";

registerBuiltInProviders();

/**
 * The hourly social sync for one tenant: inbox, public reviews, and (once a
 * day) channel analytics. Each part fails independently and is reported
 * honestly; nothing here sends anything.
 */
export async function runSocialSync(tenant: TenantSummary, now = new Date()): Promise<{ inbox: number; reviews: number; metrics: number }> {
  const cfg = await repository.getTenantConfig(tenant.id);
  const social = cfg.modules.find((m) => m.moduleKey === "social");
  const automation = cfg.automations.find((a) => a.typeKey === "social_sync");
  if (social?.enabled === false || !automation?.enabled) return { inbox: 0, reviews: 0, metrics: 0 };

  const since = new Date(now.getTime() - 2 * 3_600_000);
  const inbox = await syncInbox(tenant, since);
  const reviews = await syncReviews(tenant, new Date(now.getTime() - 7 * 86_400_000));
  // Analytics once a day, in the tenant's early morning (any run between 03:00 and 04:59 local).
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tenant.timezone, hour: "2-digit", hourCycle: "h23" }).format(now));
  const metrics = hour >= 3 && hour < 5 ? (await syncChannelMetrics(tenant, now)).recorded : 0;
  if (inbox || reviews) await repository.recordAutomationRun(tenant.id, { typeKey: "social_sync", outcome: "COMPLETED", summary: `Picked up ${inbox ? `${inbox} new comment${inbox === 1 ? "" : "s"} or message${inbox === 1 ? "" : "s"}` : ""}${inbox && reviews ? " and " : ""}${reviews ? `${reviews} new review${reviews === 1 ? "" : "s"}` : ""} from your channels.` });
  return { inbox, reviews, metrics };
}

/** New public reviews from channels that expose them (Google Business Profile, Facebook). */
export async function syncReviews(tenant: TenantSummary, since: Date): Promise<number> {
  let fresh = 0;
  for (const channel of await repository.listChannels(tenant.id, { activeOnly: true })) {
    const provider = socialProviderFor(channel.platform);
    if (!provider.fetchReviews) continue;
    const loaded = provider.name === "log" ? null : await loadChannelCredentials(tenant.id, channel);
    if (provider.name !== "log" && !loaded) continue;
    try {
      const reviews = await provider.fetchReviews(channel, loaded?.creds ?? { accessToken: "" }, since);
      for (const r of reviews) {
        const { record, created } = await repository.upsertReview(tenant.id, { provider: channel.platform === "GOOGLE_BUSINESS" ? "Google" : channel.platform === "FACEBOOK" ? "Facebook" : channel.platform, externalId: r.externalId, authorName: r.authorName, rating: r.rating, body: r.body, url: r.url, receivedAt: r.receivedAt });
        if (created) {
          fresh++;
          await emit(tenant.id, "review.received", { reviewId: record.id, provider: record.provider, rating: record.rating });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[social] review sync for ${tenant.slug}/${channel.platform} failed: ${message}`);
      if (/401|403|token|expired/i.test(message)) await flagIntegration(tenant.id, channel.platform, `Reviews could not be read: ${message}`);
    }
  }
  return fresh;
}
