import type { ChannelRecord } from "@/lib/types";
import { asNumber, failureFrom, looksLikeVideo, poll, publishFailure, publishSuccess, replyFailure, replySuccess, requestJson, settingString, toDate, type HttpResult } from "./http";
import type { ChannelCredentials, InboxItem, MetricsSnapshot, ProviderReview, PublishInput, PublishResult, ReplyResult, ReplyTarget, SocialProvider } from "./types";

/**
 * Facebook Pages + Instagram Business via the Graph API.
 *
 * Base URL: https://graph.facebook.com/{META_GRAPH_VERSION, default v21.0}
 * Auth:     `creds.accessToken` is a long-lived Page access token, sent as an
 *           Authorization: Bearer header (never in the query string).
 * Ids:      channel.externalAccountId is the Facebook Page id; Instagram
 *           channels carry the IG Business account id in settings.igUserId
 *           (falls back to externalAccountId).
 *
 * Endpoints and the permissions they need:
 *   publish FB   POST /{page}/feed, /{page}/photos, /{page}/videos        pages_manage_posts, pages_read_engagement
 *   publish IG   POST /{ig}/media, GET /{creation}?fields=status_code,
 *                POST /{ig}/media_publish, GET /{media}?fields=permalink   instagram_basic, instagram_content_publish
 *   inbox FB     GET /{page}/feed?fields=comments…, /{page}/conversations  pages_read_engagement, pages_read_user_content, pages_messaging
 *   inbox IG     GET /{ig}/media?fields=comments…                          instagram_basic, instagram_manage_comments
 *   reply        POST /{comment}/comments, /{ig-comment}/replies,
 *                POST /{page}/messages                                     pages_manage_engagement, instagram_manage_comments, pages_messaging
 *   metrics      GET /{page}?fields=…, /{page}/insights, /{ig}/insights   pages_read_engagement, read_insights, instagram_manage_insights
 *   reviews      GET /{page}/ratings                                       pages_read_user_content
 *
 * Instagram publishes the first media URL only (carousels are out of scope);
 * a video URL (by extension) is published as a Reel. Facebook publishes a
 * text/link post, a single photo, a multi-photo post via unpublished photos
 * + attached_media, or a single video via /{page}/videos.
 */

export interface MetaProviderOptions {
  /** Instagram container polling; defaults 3 s interval, 60 s cap. */
  pollIntervalMs?: number;
  pollMaxMs?: number;
}

const DEFAULT_GRAPH_VERSION = "v21.0";

function graphBase(): string {
  return `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION}`;
}

function authHeaders(creds: ChannelCredentials): Record<string, string> {
  return { Authorization: `Bearer ${creds.accessToken}` };
}

function graphGet<T>(path: string, params: Record<string, string>, creds: ChannelCredentials, fallback: string): Promise<HttpResult<T>> {
  const url = new URL(`${graphBase()}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return requestJson<T>(url, { headers: authHeaders(creds), fallback });
}

function graphPost<T>(path: string, body: Record<string, unknown>, creds: ChannelCredentials, fallback: string): Promise<HttpResult<T>> {
  return requestJson<T>(`${graphBase()}/${path}`, { method: "POST", headers: authHeaders(creds), body, fallback });
}

function igUserId(channel: ChannelRecord): string {
  return settingString(channel, "igUserId") ?? channel.externalAccountId;
}

function unixSeconds(d: Date): string {
  return String(Math.floor(d.getTime() / 1000));
}

interface GraphId {
  id?: string;
  post_id?: string;
}

interface GraphFrom {
  id?: string;
  name?: string;
}

interface FbComment {
  id?: string;
  from?: GraphFrom;
  message?: string;
  created_time?: string;
}

interface FbFeedResponse {
  data?: { id?: string; comments?: { data?: FbComment[] } }[];
}

interface FbConversationsResponse {
  data?: { id?: string; updated_time?: string; messages?: { data?: FbComment[] } }[];
}

interface IgMediaResponse {
  data?: { id?: string; comments?: { data?: { id?: string; username?: string; text?: string; timestamp?: string }[] } }[];
}

interface InsightsResponse {
  data?: { name?: string; values?: { value?: unknown; end_time?: string }[] }[];
}

interface RatingsResponse {
  data?: {
    reviewer?: GraphFrom;
    rating?: number;
    recommendation_type?: string;
    review_text?: string;
    created_time?: string;
    open_graph_story?: { id?: string };
  }[];
}

export function createMetaProvider(options: MetaProviderOptions = {}): SocialProvider {
  const pollIntervalMs = options.pollIntervalMs ?? 3_000;
  const pollMaxMs = options.pollMaxMs ?? 60_000;

  async function publishFacebook(input: PublishInput, creds: ChannelCredentials): Promise<PublishResult> {
    const pageId = input.channel.externalAccountId;
    const media = input.mediaUrls.filter(Boolean);
    let postId: string | null = null;

    if (media.length === 0) {
      const body: Record<string, unknown> = { message: input.caption };
      if (input.link) body.link = input.link;
      const r = await graphPost<GraphId>(`${pageId}/feed`, body, creds, "Facebook post failed");
      if (!r.ok) return failureFrom(r);
      postId = r.body.id ?? null;
    } else if (media.length === 1 && looksLikeVideo(media[0])) {
      const body: Record<string, unknown> = { file_url: media[0], description: input.caption };
      if (input.title) body.title = input.title;
      const r = await graphPost<GraphId>(`${pageId}/videos`, body, creds, "Facebook video post failed");
      if (!r.ok) return failureFrom(r);
      postId = r.body.id ?? null;
    } else if (media.length === 1) {
      const r = await graphPost<GraphId>(`${pageId}/photos`, { url: media[0], caption: input.caption }, creds, "Facebook photo post failed");
      if (!r.ok) return failureFrom(r);
      postId = r.body.post_id ?? r.body.id ?? null;
    } else {
      const attached: { media_fbid: string }[] = [];
      for (const url of media) {
        const r = await graphPost<GraphId>(`${pageId}/photos`, { url, published: false }, creds, "Facebook photo upload failed");
        if (!r.ok) return failureFrom(r);
        if (r.body.id) attached.push({ media_fbid: r.body.id });
      }
      const body: Record<string, unknown> = { message: input.caption, attached_media: attached };
      if (input.link) body.link = input.link;
      const r = await graphPost<GraphId>(`${pageId}/feed`, body, creds, "Facebook post failed");
      if (!r.ok) return failureFrom(r);
      postId = r.body.id ?? null;
    }

    if (!postId) return publishFailure("Facebook returned no post id", false);
    const link = await graphGet<{ permalink_url?: string }>(postId, { fields: "permalink_url" }, creds, "permalink lookup failed");
    const permalink = link.ok && link.body.permalink_url ? link.body.permalink_url : `https://www.facebook.com/${postId}`;
    return publishSuccess(postId, permalink);
  }

  async function publishInstagram(input: PublishInput, creds: ChannelCredentials): Promise<PublishResult> {
    const ig = igUserId(input.channel);
    const media = input.mediaUrls.filter(Boolean);
    if (media.length === 0) return publishFailure("Instagram posts need an image or a video", false);
    const first = media[0];
    const container: Record<string, unknown> = { caption: input.caption };
    if (looksLikeVideo(first)) {
      container.video_url = first;
      container.media_type = "REELS";
    } else {
      container.image_url = first;
    }
    const created = await graphPost<GraphId>(`${ig}/media`, container, creds, "Instagram media container failed");
    if (!created.ok) return failureFrom(created);
    const creationId = created.body.id;
    if (!creationId) return publishFailure("Instagram returned no container id", false);

    const ready = await poll<true>({ intervalMs: pollIntervalMs, maxMs: pollMaxMs, timeoutRetryable: true, what: "Instagram media processing" }, async () => {
      const s = await graphGet<{ status_code?: string; status?: string }>(creationId, { fields: "status_code,status" }, creds, "Instagram container status failed");
      if (!s.ok) return { status: "failed", error: s.error, retryable: s.retryable };
      const code = s.body.status_code ?? "";
      if (code === "FINISHED") return { status: "done", value: true };
      if (code === "ERROR" || code === "EXPIRED") return { status: "failed", error: `Instagram could not process the media (${s.body.status ?? code})`, retryable: false };
      return { status: "pending" };
    });
    if (!ready.ok) return publishFailure(ready.error, ready.retryable);

    const published = await graphPost<GraphId>(`${ig}/media_publish`, { creation_id: creationId }, creds, "Instagram publish failed");
    if (!published.ok) return failureFrom(published);
    const mediaId = published.body.id;
    if (!mediaId) return publishFailure("Instagram returned no media id", false);
    const link = await graphGet<{ permalink?: string }>(mediaId, { fields: "permalink" }, creds, "permalink lookup failed");
    return publishSuccess(mediaId, link.ok ? (link.body.permalink ?? null) : null);
  }

  async function fetchFacebookInbox(channel: ChannelRecord, creds: ChannelCredentials, since: Date): Promise<InboxItem[]> {
    const pageId = channel.externalAccountId;
    const items: InboxItem[] = [];

    const feed = await graphGet<FbFeedResponse>(
      `${pageId}/feed`,
      { fields: `id,comments.since(${unixSeconds(since)}).limit(50){id,from,message,created_time}`, limit: "25" },
      creds,
      "Facebook comments fetch failed",
    );
    if (feed.ok) {
      for (const post of feed.body.data ?? []) {
        for (const c of post.comments?.data ?? []) {
          const at = toDate(c.created_time);
          if (!c.id || !at || at < since || c.from?.id === pageId) continue;
          items.push({
            externalId: c.id,
            threadId: post.id ?? c.id,
            kind: "COMMENT",
            authorName: c.from?.name ?? null,
            authorId: c.from?.id ?? null,
            text: c.message ?? "",
            receivedAt: at,
            postExternalId: post.id ?? null,
            meta: { pageId, platform: "FACEBOOK" },
          });
        }
      }
    } else {
      console.warn(`[social:meta] facebook comments fetch failed: ${feed.error}`);
    }

    const conversations = await graphGet<FbConversationsResponse>(
      `${pageId}/conversations`,
      { fields: "id,updated_time,messages.limit(10){id,from,message,created_time}", limit: "25" },
      creds,
      "Messenger conversations fetch failed",
    );
    if (conversations.ok) {
      for (const conv of conversations.body.data ?? []) {
        const updated = toDate(conv.updated_time);
        if (updated && updated < since) continue;
        for (const m of conv.messages?.data ?? []) {
          const at = toDate(m.created_time);
          if (!m.id || !at || at < since || m.from?.id === pageId) continue;
          items.push({
            externalId: m.id,
            threadId: conv.id ?? m.id,
            kind: "DM",
            authorName: m.from?.name ?? null,
            authorId: m.from?.id ?? null,
            text: m.message ?? "",
            receivedAt: at,
            meta: { pageId, senderId: m.from?.id ?? null, platform: "FACEBOOK" },
          });
        }
      }
    } else {
      console.warn(`[social:meta] messenger conversations fetch failed: ${conversations.error}`);
    }

    return items.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  }

  async function fetchInstagramInbox(channel: ChannelRecord, creds: ChannelCredentials, since: Date): Promise<InboxItem[]> {
    const ig = igUserId(channel);
    const items: InboxItem[] = [];
    const me = await graphGet<{ username?: string }>(ig, { fields: "username" }, creds, "Instagram account lookup failed");
    const ownUsername = me.ok ? me.body.username ?? null : null;
    const media = await graphGet<IgMediaResponse>(ig + "/media", { fields: "id,comments.limit(50){id,username,text,timestamp}", limit: "25" }, creds, "Instagram comments fetch failed");
    if (!media.ok) {
      console.warn(`[social:meta] instagram comments fetch failed: ${media.error}`);
      return items;
    }
    for (const post of media.body.data ?? []) {
      for (const c of post.comments?.data ?? []) {
        const at = toDate(c.timestamp);
        if (!c.id || !at || at < since) continue;
        if (ownUsername && c.username === ownUsername) continue;
        items.push({
          externalId: c.id,
          threadId: post.id ?? c.id,
          kind: "COMMENT",
          authorName: c.username ?? null,
          authorId: null,
          text: c.text ?? "",
          receivedAt: at,
          postExternalId: post.id ?? null,
          meta: { igUserId: ig, pageId: channel.externalAccountId, platform: "INSTAGRAM" },
        });
      }
    }
    return items.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  }

  async function reply(channel: ChannelRecord, creds: ChannelCredentials, target: ReplyTarget, text: string): Promise<ReplyResult> {
    if (target.kind === "DM") {
      const senderId = typeof target.meta?.senderId === "string" ? target.meta.senderId : typeof target.meta?.authorId === "string" ? target.meta.authorId : null;
      if (!senderId) return replyFailure("Cannot reply: the message has no sender id");
      const pageId = typeof target.meta?.pageId === "string" ? target.meta.pageId : channel.externalAccountId;
      const r = await graphPost<{ message_id?: string; recipient_id?: string }>(
        `${pageId}/messages`,
        { recipient: { id: senderId }, message: { text }, messaging_type: "RESPONSE" },
        creds,
        "Messenger reply failed",
      );
      return r.ok ? replySuccess(r.body.message_id ?? null) : replyFailure(r.error);
    }
    const isInstagram = channel.platform === "INSTAGRAM" || target.meta?.platform === "INSTAGRAM";
    const r = isInstagram
      ? await graphPost<GraphId>(`${target.externalId}/replies`, { message: text }, creds, "Instagram comment reply failed")
      : await graphPost<GraphId>(`${target.externalId}/comments`, { message: text }, creds, "Facebook comment reply failed");
    return r.ok ? replySuccess(r.body.id ?? null) : replyFailure(r.error);
  }

  function lastInsightValue(res: HttpResult<InsightsResponse>, metric: string): number | null {
    if (!res.ok) return null;
    const row = (res.body.data ?? []).find((d) => d.name === metric);
    const values = row?.values ?? [];
    return values.length ? asNumber(values[values.length - 1]?.value) : null;
  }

  async function fetchFacebookMetrics(channel: ChannelRecord, creds: ChannelCredentials): Promise<MetricsSnapshot> {
    const pageId = channel.externalAccountId;
    const [page, insights] = await Promise.all([
      graphGet<{ followers_count?: number; fan_count?: number }>(pageId, { fields: "followers_count,fan_count" }, creds, "Facebook page fetch failed"),
      graphGet<InsightsResponse>(`${pageId}/insights`, { metric: "page_impressions_unique,page_post_engagements", period: "day" }, creds, "Facebook insights fetch failed"),
    ]);
    if (!page.ok) console.warn(`[social:meta] facebook page metrics failed: ${page.error}`);
    if (!insights.ok) console.warn(`[social:meta] facebook insights failed: ${insights.error}`);
    const followers = page.ok ? asNumber(page.body.followers_count) ?? asNumber(page.body.fan_count) : null;
    const reach = lastInsightValue(insights, "page_impressions_unique");
    return {
      followers,
      reach,
      impressions: reach,
      engagements: lastInsightValue(insights, "page_post_engagements"),
      raw: { page: page.ok ? page.body : null, insights: insights.ok ? insights.body : null },
    };
  }

  async function fetchInstagramMetrics(channel: ChannelRecord, creds: ChannelCredentials): Promise<MetricsSnapshot> {
    const ig = igUserId(channel);
    const [account, reach, impressions] = await Promise.all([
      graphGet<{ followers_count?: number; media_count?: number }>(ig, { fields: "followers_count,media_count" }, creds, "Instagram account fetch failed"),
      graphGet<InsightsResponse>(`${ig}/insights`, { metric: "reach", period: "day" }, creds, "Instagram insights fetch failed"),
      // `impressions` was removed for newer accounts; tolerate its absence per metric.
      graphGet<InsightsResponse>(`${ig}/insights`, { metric: "impressions", period: "day" }, creds, "Instagram impressions fetch failed"),
    ]);
    if (!account.ok) console.warn(`[social:meta] instagram account metrics failed: ${account.error}`);
    if (!reach.ok) console.warn(`[social:meta] instagram reach failed: ${reach.error}`);
    return {
      followers: account.ok ? asNumber(account.body.followers_count) : null,
      posts: account.ok ? asNumber(account.body.media_count) : null,
      reach: lastInsightValue(reach, "reach"),
      impressions: lastInsightValue(impressions, "impressions"),
      raw: { account: account.ok ? account.body : null, reach: reach.ok ? reach.body : null, impressions: impressions.ok ? impressions.body : null },
    };
  }

  async function fetchReviews(channel: ChannelRecord, creds: ChannelCredentials, since: Date): Promise<ProviderReview[]> {
    if (channel.platform !== "FACEBOOK") return [];
    const pageId = channel.externalAccountId;
    const r = await graphGet<RatingsResponse>(`${pageId}/ratings`, { fields: "reviewer,rating,recommendation_type,review_text,created_time,open_graph_story", limit: "50" }, creds, "Facebook ratings fetch failed");
    if (!r.ok) {
      console.warn(`[social:meta] facebook ratings fetch failed: ${r.error}`);
      return [];
    }
    const out: ProviderReview[] = [];
    for (const row of r.body.data ?? []) {
      const at = toDate(row.created_time);
      if (!at || at < since) continue;
      const storyId = row.open_graph_story?.id ?? null;
      out.push({
        externalId: storyId ?? `${row.reviewer?.id ?? "anon"}:${at.getTime()}`,
        authorName: row.reviewer?.name ?? null,
        rating: asNumber(row.rating),
        body: row.review_text ?? null,
        url: storyId ? `https://www.facebook.com/${storyId}` : null,
        receivedAt: at,
      });
    }
    return out.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  }

  return {
    name: "meta",
    platforms: ["FACEBOOK", "INSTAGRAM"],
    publish(input, creds) {
      return input.channel.platform === "INSTAGRAM" ? publishInstagram(input, creds) : publishFacebook(input, creds);
    },
    fetchInbox(channel, creds, since) {
      return channel.platform === "INSTAGRAM" ? fetchInstagramInbox(channel, creds, since) : fetchFacebookInbox(channel, creds, since);
    },
    reply,
    fetchMetrics(channel, creds) {
      return channel.platform === "INSTAGRAM" ? fetchInstagramMetrics(channel, creds) : fetchFacebookMetrics(channel, creds);
    },
    fetchReviews,
  };
}

export const metaSocialProvider: SocialProvider = createMetaProvider();
