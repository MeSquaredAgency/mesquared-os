import { repository } from "@/lib/data";
import { emit } from "@/lib/events";
import { getTenantObjectUrl, isStorageConfigured, storageKeyFromFileUrl } from "@/lib/storage";
import type { SocialPostRecord, TenantSummary } from "@/lib/types";
import { flagIntegration, loadChannelCredentials, rotateChannelCredentials } from "./credentials";
import { hasRealProvider, socialProviderFor } from "./providers";
import { registerBuiltInProviders } from "./providers/builtin";

export const POST_LEASE_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;

registerBuiltInProviders();

/**
 * Publishing. The tick calls `publishDuePosts` every minute; "Publish now"
 * in the console calls `publishPost`. A post is claimed before anything is
 * sent (two ticks never publish the same row), retried with backoff on
 * retryable provider errors, and after three failures becomes an exception
 * for an operator. Every outcome is logged as an automation run in plain
 * words, with "simulated" spelled out when no real platform is connected.
 */
export async function publishDuePosts(now = new Date()): Promise<{ published: number; failed: number; simulated: number }> {
  const result = { published: 0, failed: 0, simulated: 0 };
  for (const post of await repository.listDueSocialPosts(now)) {
    if (!(await repository.claimSocialPost(post.id, now, POST_LEASE_MS))) continue;
    const tenant = await repository.findTenantById(post.tenantId);
    if (!tenant) {
      await repository.updateSocialPost(post.tenantId, post.id, { status: "FAILED", errorMessage: "Workspace not found." });
      result.failed++;
      continue;
    }
    const outcome = await publishClaimed(tenant, post, now);
    result[outcome]++;
  }
  return result;
}

/** Publishes one post straight away (operator action). Claims it first like the tick does. */
export async function publishPost(tenant: TenantSummary, postId: string, now = new Date()): Promise<{ ok: boolean; message: string }> {
  const post = await repository.findSocialPostById(tenant.id, postId);
  if (!post) return { ok: false, message: "That post no longer exists." };
  if (post.status === "PUBLISHED") return { ok: false, message: "Already published." };
  if (!["SCHEDULED", "APPROVED", "FAILED", "DRAFT"].includes(post.status)) return { ok: false, message: `Can't publish a post that is ${post.status.toLowerCase().replace(/_/g, " ")}.` };
  if (post.status !== "SCHEDULED") await repository.updateSocialPost(tenant.id, post.id, { status: "SCHEDULED", scheduledFor: now, errorMessage: null });
  if (!(await repository.claimSocialPost(post.id, now, POST_LEASE_MS))) return { ok: false, message: "Another process is publishing this post right now." };
  const outcome = await publishClaimed(tenant, { ...post, status: "PUBLISHING", scheduledFor: post.scheduledFor ?? now }, now);
  return outcome === "failed" ? { ok: false, message: "Publishing failed; see the activity log." } : { ok: true, message: outcome === "simulated" ? "Logged as published (no platform connected, so nothing went out)." : "Published." };
}

/** Media URLs the platform can fetch: presigned object-storage URLs for our files, pass-through for external links. */
async function resolveMedia(tenant: TenantSummary, urls: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const u of urls) {
    const key = storageKeyFromFileUrl(u);
    if (!key) {
      out.push(u);
      continue;
    }
    if (!isStorageConfigured()) continue;
    try {
      out.push(await getTenantObjectUrl(tenant.id, key, 3600));
    } catch (error) {
      console.error(`[social] could not presign media for ${tenant.slug}: ${error instanceof Error ? error.message : error}`);
    }
  }
  return out;
}

async function publishClaimed(tenant: TenantSummary, post: SocialPostRecord, now: Date): Promise<"published" | "failed" | "simulated"> {
  const channel = post.channelId ? (await repository.listChannels(tenant.id)).find((c) => c.id === post.channelId) ?? null : null;
  const attempt = post.attempts + 1;
  const label = post.caption.split("\n")[0].slice(0, 60);

  const fail = async (error: string, retryable: boolean) => {
    if (retryable && attempt < MAX_ATTEMPTS) {
      await repository.updateSocialPost(tenant.id, post.id, { status: "SCHEDULED", attempts: attempt, errorMessage: error, scheduledFor: new Date(now.getTime() + attempt * 15 * 60_000) });
      await repository.recordAutomationRun(tenant.id, { typeKey: "social_publish", outcome: "SKIPPED", summary: `Couldn't publish "${label}" to ${platformLabel(post.platform)} yet (${error}); trying again in ${attempt * 15} minutes.` });
      return "failed" as const;
    }
    await repository.updateSocialPost(tenant.id, post.id, { status: "FAILED", attempts: attempt, errorMessage: error });
    await repository.recordAutomationRun(tenant.id, { typeKey: "social_publish", outcome: "FAILED", summary: `Couldn't publish "${label}" to ${platformLabel(post.platform)}: ${error}` });
    await repository.createException(tenant.id, { reason: `A ${platformLabel(post.platform)} post failed to publish: ${error}`, suggestedAction: "Check the channel connection in the console, then publish it again or post it by hand.", confidence: 0.9 });
    await emit(tenant.id, "social.publish_failed", { postId: post.id, platform: post.platform, error });
    return "failed" as const;
  };

  if (!channel) return fail("No connected channel for this platform.", false);

  const provider = socialProviderFor(post.platform);
  const loaded = hasRealProvider(post.platform) ? await loadChannelCredentials(tenant.id, channel) : null;
  if (hasRealProvider(post.platform) && !loaded) return fail(`${platformLabel(post.platform)} is not connected (no credentials on file).`, false);

  let creds = loaded?.creds ?? { accessToken: "" };
  if (loaded && provider.refreshCredentials && creds.expiresAt && new Date(creds.expiresAt).getTime() < now.getTime() + 5 * 60_000) {
    const fresh = await provider.refreshCredentials(creds).catch(() => null);
    if (fresh) {
      creds = fresh;
      await rotateChannelCredentials(tenant.id, loaded.integrationId, post.platform, fresh);
    }
  }

  const mediaUrls = await resolveMedia(tenant, post.mediaUrls);
  const result = await provider.publish({ channel, caption: post.caption, mediaUrls, title: post.caption.split("\n")[0] }, creds);
  if (!result.ok) {
    if (/401|403|token|expired|permission/i.test(result.error ?? "")) await flagIntegration(tenant.id, post.platform, result.error ?? "Publishing was refused.");
    return fail(result.error ?? "The platform refused the post.", Boolean(result.retryable));
  }

  await repository.updateSocialPost(tenant.id, post.id, { status: "PUBLISHED", publishedAt: now, attempts: attempt, externalPostId: result.externalPostId, permalink: result.permalink, errorMessage: null });
  if (post.contentAssetId) await repository.updateContentAssetStatus(tenant.id, post.contentAssetId, "PUBLISHED");
  await repository.recordAutomationRun(tenant.id, {
    typeKey: "social_publish",
    outcome: result.simulated ? "SKIPPED" : "COMPLETED",
    summary: result.simulated ? `Marked "${label}" as published on ${platformLabel(post.platform)}; no platform is connected, so nothing went out.` : `Published "${label}" to ${platformLabel(post.platform)}.`,
    details: { postId: post.id, permalink: result.permalink },
  });
  await emit(tenant.id, "social.published", { postId: post.id, platform: post.platform, externalPostId: result.externalPostId, simulated: result.simulated });
  return result.simulated ? "simulated" : "published";
}

export function platformLabel(platform: SocialPostRecord["platform"]): string {
  return { FACEBOOK: "Facebook", INSTAGRAM: "Instagram", TIKTOK: "TikTok", YOUTUBE: "YouTube", LINKEDIN: "LinkedIn", GOOGLE_BUSINESS: "Google Business" }[platform];
}
