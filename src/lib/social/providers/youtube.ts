import type { ChannelRecord } from "@/lib/types";
import { freshGoogleCredentials, refreshGoogleCredentials } from "./google-oauth";
import { asNumber, fetchBytes, formatBytes, networkErrorText, publishFailure, publishSuccess, replyFailure, replySuccess, requestJson, settingString, stripHtml, toDate, truncate } from "./http";
import { isRetryableStatus, providerError, type ChannelCredentials, type InboxItem, type MetricsSnapshot, type PublishInput, type PublishResult, type ReplyResult, type ReplyTarget, type SocialProvider } from "./types";

/**
 * YouTube Data API v3.
 *
 * Auth:  Google OAuth2 user token (scopes https://www.googleapis.com/auth/youtube.upload
 *        for publishing, https://www.googleapis.com/auth/youtube.force-ssl for
 *        comments and replies, youtube.readonly for statistics); refreshed via
 *        ./google-oauth when `expiresAt` is past.
 * Ids:   channel.externalAccountId is the YouTube channel id.
 *
 * Endpoints:
 *   publish  POST https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status&uploadType=multipart
 *            (multipart/related: JSON snippet/status + the video bytes downloaded from mediaUrls[0], capped at 256 MB)
 *   metrics  GET  https://www.googleapis.com/youtube/v3/channels?part=statistics&id={channelId}
 *   inbox    GET  https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&allThreadsRelatedToChannelId={channelId}&order=time&maxResults=50
 *   reply    POST https://www.googleapis.com/youtube/v3/comments?part=snippet
 *
 * Privacy comes from channel.settings.privacyStatus (default "public"). Tags are
 * the #hashtags found in the caption, since PublishInput carries none.
 */

const DATA_API = "https://www.googleapis.com/youtube/v3";
const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status&uploadType=multipart";
const VIDEO_MAX_BYTES = 256 * 1024 * 1024;
const TITLE_MAX = 100;
const DESCRIPTION_MAX = 5000;

function bearer(creds: ChannelCredentials): Record<string, string> {
  return { Authorization: `Bearer ${creds.accessToken}` };
}

export function youtubeTitle(input: PublishInput): string {
  const fromTitle = input.title?.trim();
  const firstLine = input.caption.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "Untitled";
  return truncate(fromTitle || firstLine, TITLE_MAX);
}

export function hashtags(caption: string): string[] {
  return Array.from(new Set((caption.match(/#([\p{L}\p{N}_]+)/gu) ?? []).map((t) => t.slice(1)))).slice(0, 30);
}

/** Builds a multipart/related body: a JSON metadata part followed by the media part. */
export function multipartRelated(metadata: unknown, media: Uint8Array, mediaType: string): { body: Uint8Array; contentType: string } {
  const boundary = `mesquared_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const enc = new TextEncoder();
  const head = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mediaType}\r\n\r\n`);
  const tail = enc.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.byteLength + media.byteLength + tail.byteLength);
  body.set(head, 0);
  body.set(media, head.byteLength);
  body.set(tail, head.byteLength + media.byteLength);
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

interface CommentThreadsResponse {
  items?: {
    id?: string;
    snippet?: {
      videoId?: string;
      topLevelComment?: {
        id?: string;
        snippet?: { authorDisplayName?: string; authorChannelId?: { value?: string }; textDisplay?: string; textOriginal?: string; publishedAt?: string; videoId?: string };
      };
    };
  }[];
}

export function createYouTubeProvider(): SocialProvider {
  async function publish(input: PublishInput, given: ChannelCredentials): Promise<PublishResult> {
    const videos = input.mediaUrls.filter(Boolean);
    if (videos.length !== 1) return publishFailure(`YouTube needs exactly one video URL (got ${videos.length})`, false);
    const fresh = await freshGoogleCredentials(given);
    if (!fresh.ok) return publishFailure(fresh.error, fresh.retryable);
    const creds = fresh.creds;

    const download = await fetchBytes(videos[0], VIDEO_MAX_BYTES, 10 * 60_000);
    if (!download.ok) return publishFailure(download.error.includes("limit") ? `${download.error} for YouTube uploads (${formatBytes(VIDEO_MAX_BYTES)})` : download.error, download.retryable);
    const mediaType = download.contentType.startsWith("video/") || download.contentType === "application/octet-stream" ? download.contentType : "video/*";

    const metadata = {
      snippet: {
        title: youtubeTitle(input),
        description: truncate(input.caption, DESCRIPTION_MAX),
        tags: hashtags(input.caption),
      },
      status: {
        privacyStatus: settingString(input.channel, "privacyStatus") ?? "public",
        selfDeclaredMadeForKids: false,
      },
    };
    const { body, contentType } = multipartRelated(metadata, download.bytes, mediaType);

    // The upload is a plain fetch rather than requestJson so the byte body goes out untouched.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15 * 60_000);
    try {
      const res = await fetch(UPLOAD_URL, { method: "POST", headers: { ...bearer(creds), "Content-Type": contentType }, body: body as unknown as BodyInit, signal: controller.signal });
      const text = await res.text();
      let json: Record<string, unknown> = {};
      try {
        json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        json = { message: text.slice(0, 200) };
      }
      if (!res.ok) return publishFailure(providerError(res.status, json, "YouTube upload failed"), isRetryableStatus(res.status));
      const id = typeof json.id === "string" ? json.id : null;
      if (!id) return publishFailure("YouTube accepted the upload but returned no video id", false);
      return publishSuccess(id, `https://www.youtube.com/watch?v=${id}`);
    } catch (err) {
      return publishFailure(networkErrorText(err), true);
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchMetrics(channel: ChannelRecord, given: ChannelCredentials): Promise<MetricsSnapshot> {
    const fresh = await freshGoogleCredentials(given);
    if (!fresh.ok) {
      console.warn(`[social:youtube] metrics skipped: ${fresh.error}`);
      return {};
    }
    const url = new URL(`${DATA_API}/channels`);
    url.searchParams.set("part", "statistics");
    url.searchParams.set("id", channel.externalAccountId);
    const r = await requestJson<{ items?: { statistics?: { subscriberCount?: string; viewCount?: string; videoCount?: string } }[] }>(url, { headers: bearer(fresh.creds), fallback: "YouTube statistics fetch failed" });
    if (!r.ok) {
      console.warn(`[social:youtube] statistics fetch failed: ${r.error}`);
      return {};
    }
    const stats = r.body.items?.[0]?.statistics;
    if (!stats) return {};
    return {
      followers: asNumber(stats.subscriberCount),
      impressions: asNumber(stats.viewCount),
      posts: asNumber(stats.videoCount),
      raw: { statistics: stats },
    };
  }

  async function fetchInbox(channel: ChannelRecord, given: ChannelCredentials, since: Date): Promise<InboxItem[]> {
    const fresh = await freshGoogleCredentials(given);
    if (!fresh.ok) {
      console.warn(`[social:youtube] inbox skipped: ${fresh.error}`);
      return [];
    }
    const url = new URL(`${DATA_API}/commentThreads`);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("allThreadsRelatedToChannelId", channel.externalAccountId);
    url.searchParams.set("order", "time");
    url.searchParams.set("maxResults", "50");
    const r = await requestJson<CommentThreadsResponse>(url, { headers: bearer(fresh.creds), fallback: "YouTube comments fetch failed" });
    if (!r.ok) {
      console.warn(`[social:youtube] comments fetch failed: ${r.error}`);
      return [];
    }
    const items: InboxItem[] = [];
    for (const thread of r.body.items ?? []) {
      const top = thread.snippet?.topLevelComment;
      const s = top?.snippet;
      const at = toDate(s?.publishedAt);
      const id = top?.id ?? thread.id;
      if (!id || !s || !at || at < since) continue;
      if (s.authorChannelId?.value && s.authorChannelId.value === channel.externalAccountId) continue;
      const videoId = s.videoId ?? thread.snippet?.videoId ?? null;
      items.push({
        externalId: id,
        threadId: videoId ?? id,
        kind: "COMMENT",
        authorName: s.authorDisplayName ?? null,
        authorId: s.authorChannelId?.value ?? null,
        text: s.textOriginal ?? stripHtml(s.textDisplay ?? ""),
        receivedAt: at,
        postExternalId: videoId,
        meta: { videoId, channelId: channel.externalAccountId },
      });
    }
    return items.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  }

  async function reply(_channel: ChannelRecord, given: ChannelCredentials, target: ReplyTarget, text: string): Promise<ReplyResult> {
    if (target.kind !== "COMMENT") return replyFailure("YouTube has no direct messages");
    const fresh = await freshGoogleCredentials(given);
    if (!fresh.ok) return replyFailure(fresh.error);
    const r = await requestJson<{ id?: string }>(`${DATA_API}/comments?part=snippet`, {
      method: "POST",
      headers: bearer(fresh.creds),
      body: { snippet: { parentId: target.externalId, textOriginal: text } },
      fallback: "YouTube comment reply failed",
    });
    return r.ok ? replySuccess(r.body.id ?? null) : replyFailure(r.error);
  }

  return {
    name: "youtube",
    platforms: ["YOUTUBE"],
    publish,
    fetchMetrics,
    fetchInbox,
    reply,
    refreshCredentials: refreshGoogleCredentials,
  };
}

export const youtubeSocialProvider: SocialProvider = createYouTubeProvider();
