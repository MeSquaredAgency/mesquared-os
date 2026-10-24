import type { ChannelRecord } from "@/lib/types";
import { asNumber, poll, publishFailure, publishSuccess, requestJson, settingString, truncate, type HttpResult } from "./http";
import type { ChannelCredentials, MetricsSnapshot, PublishInput, PublishResult, SocialProvider } from "./types";

/**
 * TikTok Content Posting API + Login Kit.
 *
 * Auth:  `creds.accessToken` is a user token (scopes video.publish for direct
 *        post, user.info.basic + user.info.stats for metrics); refreshed with
 *        creds.refreshToken when `expiresAt` is past.
 * Env:   TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET.
 * Ids:   channel.externalAccountId is the creator's open id (informational;
 *        every call is scoped by the token).
 *
 * Endpoints:
 *   publish   POST https://open.tiktokapis.com/v2/post/publish/video/init/   (source PULL_FROM_URL)
 *             POST https://open.tiktokapis.com/v2/post/publish/status/fetch/ polled until PUBLISH_COMPLETE / FAILED
 *   refresh   POST https://open.tiktokapis.com/v2/oauth/token/               (grant_type=refresh_token)
 *   metrics   GET  https://open.tiktokapis.com/v2/user/info/?fields=follower_count,likes_count,video_count
 *
 * PULL_FROM_URL only works when the domain the video URL is served from has
 * been verified under the app in the TikTok developer portal (URL ownership
 * verification); presigned object-storage URLs must come from that domain.
 * TikTok returns HTTP 200 with `error.code !== "ok"` for many failures, so
 * every response is checked for that as well as the HTTP status. No inbox.
 */

export interface TikTokProviderOptions {
  /** Publish status polling; defaults 3 s interval, 90 s cap. */
  pollIntervalMs?: number;
  pollMaxMs?: number;
}

const API = "https://open.tiktokapis.com/v2";
const TITLE_MAX = 2200;
const EXPIRY_SKEW_MS = 60_000;

interface TikTokError {
  code?: string;
  message?: string;
  log_id?: string;
}

interface TikTokEnvelope<T> {
  data?: T;
  error?: TikTokError;
}

function headers(creds: ChannelCredentials): Record<string, string> {
  return { Authorization: `Bearer ${creds.accessToken}`, "Content-Type": "application/json; charset=UTF-8" };
}

/** Collapses TikTok's two failure styles (HTTP error, or 200 with error.code) into one. */
function tiktokFailure<T>(r: HttpResult<TikTokEnvelope<T>>): { error: string; retryable: boolean } | null {
  if (!r.ok) return { error: r.error, retryable: r.retryable };
  const code = r.body.error?.code;
  if (code && code !== "ok") {
    const retryable = code === "rate_limit_exceeded" || code === "internal_error" || code === "spam_risk_too_many_pending_share";
    return { error: `${r.body.error?.message ?? code} (TikTok ${code}, HTTP ${r.status})`.slice(0, 300), retryable };
  }
  return null;
}

function tokenExpired(creds: ChannelCredentials): boolean {
  if (!creds.expiresAt) return false;
  const at = new Date(creds.expiresAt).getTime();
  return Number.isFinite(at) && at - EXPIRY_SKEW_MS <= Date.now();
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  open_id?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

type RefreshOutcome = { ok: true; creds: ChannelCredentials } | { ok: false; error: string; retryable: boolean };

async function refreshToken(creds: ChannelCredentials, env: NodeJS.ProcessEnv = process.env): Promise<RefreshOutcome> {
  if (!creds.refreshToken) return { ok: false, error: "TikTok token expired and no refresh token is stored; reconnect the channel", retryable: false };
  const clientKey = env.TIKTOK_CLIENT_KEY;
  const clientSecret = env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) return { ok: false, error: "TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET are not configured", retryable: false };
  const form = new URLSearchParams({ client_key: clientKey, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: creds.refreshToken });
  const r = await requestJson<TokenResponse>(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: form,
    fallback: "TikTok token refresh failed",
  });
  if (!r.ok) return { ok: false, error: `TikTok token refresh failed: ${r.error}`, retryable: r.retryable };
  if (r.body.error) return { ok: false, error: `TikTok token refresh failed: ${r.body.error_description ?? r.body.error}`, retryable: false };
  if (!r.body.access_token) return { ok: false, error: "TikTok token refresh returned no access token", retryable: false };
  const expiresIn = typeof r.body.expires_in === "number" ? r.body.expires_in : 86_400;
  return {
    ok: true,
    creds: {
      ...creds,
      accessToken: r.body.access_token,
      refreshToken: r.body.refresh_token ?? creds.refreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
      ...(r.body.open_id ? { openId: r.body.open_id } : {}),
    },
  };
}

async function freshCredentials(creds: ChannelCredentials): Promise<RefreshOutcome> {
  if (!tokenExpired(creds)) return { ok: true, creds };
  return refreshToken(creds);
}

interface InitData {
  publish_id?: string;
}

interface StatusData {
  status?: string;
  fail_reason?: string;
  publicaly_available_post_id?: (string | number)[];
  uploaded_bytes?: number;
}

/**
 * TikTok post ids are 19-digit integers, past 2^53, so JSON.parse rounds
 * them. Read the first one straight out of the response text instead.
 */
export function publicPostIdFrom(text: string, parsed: StatusData): string | null {
  const m = text.match(/"publicaly_available_post_id"\s*:\s*\[\s*"?(\d+)"?/);
  if (m) return m[1];
  const first = parsed.publicaly_available_post_id?.[0];
  return first === undefined || first === null ? null : String(first);
}

export function createTikTokProvider(options: TikTokProviderOptions = {}): SocialProvider {
  const pollIntervalMs = options.pollIntervalMs ?? 3_000;
  const pollMaxMs = options.pollMaxMs ?? 90_000;

  async function publish(input: PublishInput, given: ChannelCredentials): Promise<PublishResult> {
    const videos = input.mediaUrls.filter(Boolean);
    if (videos.length !== 1) return publishFailure(`TikTok needs exactly one video URL (got ${videos.length})`, false);
    const fresh = await freshCredentials(given);
    if (!fresh.ok) return publishFailure(fresh.error, fresh.retryable);
    const creds = fresh.creds;

    const init = await requestJson<TikTokEnvelope<InitData>>(`${API}/post/publish/video/init/`, {
      method: "POST",
      headers: headers(creds),
      body: {
        post_info: {
          title: truncate(input.caption, TITLE_MAX),
          privacy_level: settingString(input.channel, "privacyLevel") ?? "PUBLIC_TO_EVERYONE",
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: { source: "PULL_FROM_URL", video_url: videos[0] },
      },
      fallback: "TikTok publish could not be started",
    });
    const initFailure = tiktokFailure(init);
    if (initFailure) return publishFailure(initFailure.error, initFailure.retryable);
    const publishId = init.ok ? init.body.data?.publish_id : undefined;
    if (!publishId) return publishFailure("TikTok returned no publish id", false);

    const done = await poll<{ data: StatusData; text: string }>({ intervalMs: pollIntervalMs, maxMs: pollMaxMs, timeoutRetryable: false, what: "TikTok publishing" }, async () => {
      const s = await requestJson<TikTokEnvelope<StatusData>>(`${API}/post/publish/status/fetch/`, {
        method: "POST",
        headers: headers(creds),
        body: { publish_id: publishId },
        fallback: "TikTok publish status failed",
      });
      const failure = tiktokFailure(s);
      if (failure) return { status: "failed", ...failure };
      const data = s.ok ? s.body.data ?? {} : {};
      if (data.status === "PUBLISH_COMPLETE") return { status: "done", value: { data, text: s.ok ? s.text : "" } };
      if (data.status === "FAILED") return { status: "failed", error: `TikTok rejected the video: ${data.fail_reason ?? "unknown reason"}`, retryable: false };
      return { status: "pending" };
    });
    if (!done.ok) return publishFailure(done.error, done.retryable);
    const postId = publicPostIdFrom(done.value.text, done.value.data);
    const username = settingString(input.channel, "username");
    const permalink = postId && username ? `https://www.tiktok.com/@${username}/video/${postId}` : null;
    return publishSuccess(postId ?? publishId, permalink);
  }

  async function fetchMetrics(_channel: ChannelRecord, given: ChannelCredentials): Promise<MetricsSnapshot> {
    const fresh = await freshCredentials(given);
    if (!fresh.ok) {
      console.warn(`[social:tiktok] metrics skipped: ${fresh.error}`);
      return {};
    }
    const url = new URL(`${API}/user/info/`);
    url.searchParams.set("fields", "follower_count,likes_count,video_count");
    const r = await requestJson<TikTokEnvelope<{ user?: { follower_count?: number; likes_count?: number; video_count?: number } }>>(url, { headers: headers(fresh.creds), fallback: "TikTok user info failed" });
    const failure = tiktokFailure(r);
    if (failure || !r.ok) {
      console.warn(`[social:tiktok] user info failed: ${failure?.error ?? "unknown"}`);
      return {};
    }
    const user = r.body.data?.user;
    if (!user) return {};
    return {
      followers: asNumber(user.follower_count),
      engagements: asNumber(user.likes_count),
      posts: asNumber(user.video_count),
      raw: { user: user as Record<string, unknown> },
    };
  }

  return {
    name: "tiktok",
    platforms: ["TIKTOK"],
    publish,
    fetchMetrics,
    async refreshCredentials(creds) {
      if (!creds.refreshToken) return null;
      const r = await refreshToken(creds);
      if (!r.ok) {
        console.warn(`[social:tiktok] token refresh failed: ${r.error}`);
        return null;
      }
      return r.creds;
    },
  };
}

export const tiktokSocialProvider: SocialProvider = createTikTokProvider();
