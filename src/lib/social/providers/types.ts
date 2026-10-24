import type { ChannelRecord, SocialPlatform } from "@/lib/types";

/**
 * Social platform adapters. One implementation per platform family; the app
 * talks only to this interface. Every call is best-effort and reports
 * failures as values, never throws for provider errors: the publisher and the
 * sync job turn `ok: false` into an honest run, an exception for an operator,
 * and a retry where that makes sense.
 *
 * Adapters receive decrypted credentials per call and must never log them,
 * the access token, or a full response body. Log the HTTP status and the
 * provider's error message only.
 */

/** Credentials stored (encrypted) on the tenant's Integration row for the platform. */
export interface ChannelCredentials {
  accessToken: string;
  refreshToken?: string | null;
  /** ISO timestamp; adapters that know how to refresh may do so when this is near. */
  expiresAt?: string | null;
  /** Provider-specific extras (e.g. a page-scoped token, an app id). */
  [key: string]: unknown;
}

export interface PublishInput {
  channel: ChannelRecord;
  /** The post text, already compliance-checked and within the platform limit. */
  caption: string;
  /** Publicly reachable URLs (presigned object-storage URLs are fine). Images first; one video for video platforms. */
  mediaUrls: string[];
  /** YouTube title / GBP summary headline; ignored where the platform has no title. */
  title?: string | null;
  /** Optional link for platforms that attach one (Facebook link post, GBP call-to-action). */
  link?: string | null;
}

export interface PublishResult {
  ok: boolean;
  externalPostId: string | null;
  permalink: string | null;
  /** Provider error text, safe to show an operator. Null on success. */
  error: string | null;
  /** True when nothing was published because the adapter is the log provider (demo/dev). */
  simulated: boolean;
  /** True when the failure is worth retrying later (rate limit, 5xx, network). */
  retryable?: boolean;
}

export interface InboxItem {
  /** Stable id of the comment or message on the platform. */
  externalId: string;
  /** Thread this item belongs to: the post id for comments, the conversation id for DMs. */
  threadId: string;
  kind: "COMMENT" | "DM";
  authorName: string | null;
  authorId: string | null;
  text: string;
  receivedAt: Date;
  /** For comments: the post commented on, when known. */
  postExternalId?: string | null;
  /** Anything the adapter needs later to reply (e.g. page id). */
  meta?: Record<string, unknown>;
}

export interface ReplyTarget {
  kind: "COMMENT" | "DM";
  threadId: string;
  externalId: string;
  meta?: Record<string, unknown>;
}

export interface ReplyResult {
  ok: boolean;
  externalId: string | null;
  error: string | null;
  simulated: boolean;
}

export interface MetricsSnapshot {
  followers?: number | null;
  reach?: number | null;
  impressions?: number | null;
  engagements?: number | null;
  clicks?: number | null;
  posts?: number | null;
  raw?: Record<string, unknown>;
}

export interface ProviderReview {
  externalId: string;
  authorName: string | null;
  rating: number | null;
  body: string | null;
  url: string | null;
  receivedAt: Date;
}

export interface SocialProvider {
  readonly name: string;
  readonly platforms: SocialPlatform[];
  publish(input: PublishInput, creds: ChannelCredentials): Promise<PublishResult>;
  /** Comments and DMs since `since`, newest last. Omit on platforms without an inbox API. */
  fetchInbox?(channel: ChannelRecord, creds: ChannelCredentials, since: Date): Promise<InboxItem[]>;
  reply?(channel: ChannelRecord, creds: ChannelCredentials, target: ReplyTarget, text: string): Promise<ReplyResult>;
  fetchMetrics?(channel: ChannelRecord, creds: ChannelCredentials): Promise<MetricsSnapshot>;
  /** Public reviews (Google Business Profile, Facebook recommendations). */
  fetchReviews?(channel: ChannelRecord, creds: ChannelCredentials, since: Date): Promise<ProviderReview[]>;
  replyToReview?(channel: ChannelRecord, creds: ChannelCredentials, reviewExternalId: string, text: string): Promise<ReplyResult>;
  /** Refreshes an expiring token when the platform supports it; returns the new credentials or null when nothing changed. */
  refreshCredentials?(creds: ChannelCredentials): Promise<ChannelCredentials | null>;
}

/** Small helpers shared by adapters. */
export function providerError(status: number, body: unknown, fallback: string): string {
  const b = body as { error?: { message?: string } | string; message?: string; error_description?: string } | null;
  const msg = (typeof b?.error === "object" && b.error?.message) || (typeof b?.error === "string" ? b.error : null) || b?.message || b?.error_description || fallback;
  return `${msg} (HTTP ${status})`.slice(0, 300);
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
