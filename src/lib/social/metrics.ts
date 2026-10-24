import { repository } from "@/lib/data";
import type { ChannelMetricSnapshotRecord, ChannelRecord, SocialPlatform, TenantSummary } from "@/lib/types";
import { flagIntegration, loadChannelCredentials } from "./credentials";
import { socialProviderFor } from "./providers";
import { registerBuiltInProviders } from "./providers/builtin";

registerBuiltInProviders();

/**
 * Daily channel analytics: one snapshot per channel per day from the
 * platform's own numbers, and a summary the portal can show without jargon
 * (followers, reach this week, engagements this week, change since last week).
 */
export async function syncChannelMetrics(tenant: TenantSummary, now = new Date()): Promise<{ channels: number; recorded: number }> {
  const channels = await repository.listChannels(tenant.id, { activeOnly: true });
  let recorded = 0;
  for (const channel of channels) {
    const provider = socialProviderFor(channel.platform);
    if (!provider.fetchMetrics) continue;
    const loaded = await loadChannelCredentials(tenant.id, channel);
    if (!loaded && provider.name !== "log") continue;
    try {
      const snapshot = await provider.fetchMetrics(channel, loaded?.creds ?? { accessToken: "" });
      if (Object.keys(snapshot).length === 0) continue;
      await repository.recordChannelMetrics(tenant.id, { channelId: channel.id, platform: channel.platform, date: now, ...snapshot });
      recorded++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[social] metrics for ${tenant.slug}/${channel.platform} failed: ${message}`);
      if (/401|403|token|expired/i.test(message)) await flagIntegration(tenant.id, channel.platform, `Analytics could not be read: ${message}`);
    }
  }
  return { channels: channels.length, recorded };
}

export interface ChannelSummary {
  channel: ChannelRecord;
  followers: number | null;
  followersChange: number | null;
  reach7d: number | null;
  engagements7d: number | null;
  posts7d: number;
  lastSnapshot: Date | null;
}

/** Plain numbers per channel from the last 14 days of snapshots. */
export function summarizeChannels(channels: ChannelRecord[], snapshots: ChannelMetricSnapshotRecord[], now = new Date()): ChannelSummary[] {
  const weekAgo = now.getTime() - 7 * 86_400_000;
  const twoWeeksAgo = now.getTime() - 14 * 86_400_000;
  return channels.map((channel) => {
    const mine = snapshots.filter((s) => s.channelId === channel.id).sort((a, b) => a.date.getTime() - b.date.getTime());
    const latest = mine.at(-1) ?? null;
    const thisWeek = mine.filter((s) => s.date.getTime() >= weekAgo);
    const lastWeek = mine.filter((s) => s.date.getTime() >= twoWeeksAgo && s.date.getTime() < weekAgo);
    const sum = (rows: ChannelMetricSnapshotRecord[], key: "reach" | "engagements" | "posts") => (rows.some((r) => r[key] !== null) ? rows.reduce((n, r) => n + (r[key] ?? 0), 0) : null);
    const followersLastWeek = lastWeek.at(-1)?.followers ?? null;
    return {
      channel,
      followers: latest?.followers ?? null,
      followersChange: latest?.followers != null && followersLastWeek != null ? latest.followers - followersLastWeek : null,
      reach7d: sum(thisWeek, "reach"),
      engagements7d: sum(thisWeek, "engagements"),
      posts7d: sum(thisWeek, "posts") ?? 0,
      lastSnapshot: latest?.date ?? null,
    };
  });
}

export const PLATFORM_ORDER: SocialPlatform[] = ["FACEBOOK", "INSTAGRAM", "GOOGLE_BUSINESS", "LINKEDIN", "YOUTUBE", "TIKTOK"];
