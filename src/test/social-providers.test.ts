import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { registerBuiltInProviders } from "@/lib/social/providers/builtin";
import { createGoogleBusinessProvider } from "@/lib/social/providers/google-business";
import { refreshGoogleToken, tokenExpired } from "@/lib/social/providers/google-oauth";
import { hasRealProvider, socialProviderFor } from "@/lib/social/providers/index";
import { createLinkedInProvider } from "@/lib/social/providers/linkedin";
import { createMetaProvider } from "@/lib/social/providers/meta";
import { createTikTokProvider } from "@/lib/social/providers/tiktok";
import type { ChannelCredentials, PublishInput } from "@/lib/social/providers/types";
import { createYouTubeProvider, multipartRelated } from "@/lib/social/providers/youtube";
import type { ChannelRecord, SocialPlatform } from "@/lib/types";

/* ---------- fetch stub ---------- */

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | Uint8Array | null;
  json(): Record<string, unknown>;
  form(): URLSearchParams;
}

type Handler = (call: RecordedCall) => Response | Promise<Response>;

let calls: RecordedCall[] = [];
let handler: Handler = () => json({}, 404);
const realFetch = globalThis.fetch;

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function headerRecord(h: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (h instanceof Headers) h.forEach((v, k) => (out[k.toLowerCase()] = v));
  else if (Array.isArray(h)) for (const [k, v] of h) out[k.toLowerCase()] = v;
  else for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v;
  return out;
}

async function recordedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const rawBody = init?.body;
  let body: string | Uint8Array | null = null;
  if (typeof rawBody === "string") body = rawBody;
  else if (rawBody instanceof URLSearchParams) body = rawBody.toString();
  else if (rawBody instanceof Uint8Array) body = rawBody;
  const call: RecordedCall = {
    url,
    method: (init?.method ?? "GET").toUpperCase(),
    headers: headerRecord(init?.headers),
    body,
    json() {
      return JSON.parse(typeof body === "string" ? body : "{}") as Record<string, unknown>;
    },
    form() {
      return new URLSearchParams(typeof body === "string" ? body : "");
    },
  };
  calls.push(call);
  return handler(call);
}

/** Routes by "METHOD host/path" prefix; unmatched calls return 404 so a stray request fails loudly. */
function route(table: Record<string, Handler>): Handler {
  return (call) => {
    const path = call.url.replace(/^https?:\/\//, "").split("?")[0];
    const key = `${call.method} ${path}`;
    const hit = Object.keys(table)
      .sort((a, b) => b.length - a.length)
      .find((k) => key === k || key.startsWith(k));
    return hit ? table[hit](call) : json({ error: { message: `no stub for ${key}` } }, 404);
  };
}

function callsTo(pathPart: string, method?: string): RecordedCall[] {
  return calls.filter((c) => c.url.includes(pathPart) && (!method || c.method === method));
}

/* ---------- fixtures ---------- */

function channel(platform: SocialPlatform, externalAccountId: string, settings: Record<string, unknown> = {}): ChannelRecord {
  return { id: `ch_${platform.toLowerCase()}`, tenantId: "t1", integrationId: null, platform, externalAccountId, displayName: null, isActive: true, settings };
}

const creds: ChannelCredentials = { accessToken: "tok_live_abc" };

function publishInput(ch: ChannelRecord, extra: Partial<PublishInput> = {}): PublishInput {
  return { channel: ch, caption: "Hello from the test suite", mediaUrls: [], title: null, link: null, ...extra };
}

const SINCE = new Date("2026-10-20T00:00:00Z");

before(() => {
  globalThis.fetch = recordedFetch as typeof fetch;
});

after(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  calls = [];
  handler = () => json({}, 404);
});

/* ---------- Meta ---------- */

describe("meta provider", () => {
  const meta = createMetaProvider({ pollIntervalMs: 1, pollMaxMs: 500 });
  const fb = channel("FACEBOOK", "page1");
  const ig = channel("INSTAGRAM", "page1", { igUserId: "ig1" });

  it("publishes a Facebook text post with a link and resolves the permalink", async () => {
    handler = route({
      "POST graph.facebook.com/v21.0/page1/feed": () => json({ id: "page1_111" }),
      "GET graph.facebook.com/v21.0/page1_111": () => json({ permalink_url: "https://www.facebook.com/page1/posts/111" }),
    });
    const r = await meta.publish(publishInput(fb, { link: "https://example.test/offer" }), creds);
    assert.equal(r.ok, true);
    assert.equal(r.externalPostId, "page1_111");
    assert.equal(r.permalink, "https://www.facebook.com/page1/posts/111");
    assert.equal(r.simulated, false);
    const post = calls[0];
    assert.equal(post.method, "POST");
    assert.equal(post.url, "https://graph.facebook.com/v21.0/page1/feed");
    assert.equal(post.headers.authorization, "Bearer tok_live_abc");
    assert.deepEqual(post.json(), { message: "Hello from the test suite", link: "https://example.test/offer" });
    assert.ok(!post.url.includes("tok_live_abc"), "token must not travel in the URL");
  });

  it("uploads several photos unpublished and attaches them to one feed post", async () => {
    let n = 0;
    handler = route({
      "POST graph.facebook.com/v21.0/page1/photos": () => json({ id: `photo${++n}` }),
      "POST graph.facebook.com/v21.0/page1/feed": () => json({ id: "page1_222" }),
      "GET graph.facebook.com/v21.0/page1_222": () => json({}, 500),
    });
    const r = await meta.publish(publishInput(fb, { mediaUrls: ["https://cdn.test/a.jpg", "https://cdn.test/b.jpg"] }), creds);
    assert.equal(r.ok, true);
    const photos = callsTo("/page1/photos");
    assert.equal(photos.length, 2);
    assert.deepEqual(photos[0].json(), { url: "https://cdn.test/a.jpg", published: false });
    const feed = callsTo("/page1/feed")[0].json();
    assert.deepEqual(feed.attached_media, [{ media_fbid: "photo1" }, { media_fbid: "photo2" }]);
    assert.equal(r.permalink, "https://www.facebook.com/page1_222", "falls back to a constructed permalink when the lookup fails");
  });

  it("maps a rate-limited Graph error to a retryable failure that carries the status", async () => {
    handler = () => json({ error: { message: "Application request limit reached", code: 4 } }, 429);
    const r = await meta.publish(publishInput(fb), creds);
    assert.equal(r.ok, false);
    assert.equal(r.retryable, true);
    assert.match(r.error ?? "", /request limit reached \(HTTP 429\)/);
    assert.equal(r.externalPostId, null);
  });

  it("marks a 400 as not retryable", async () => {
    handler = () => json({ error: { message: "Invalid parameter" } }, 400);
    const r = await meta.publish(publishInput(fb), creds);
    assert.equal(r.ok, false);
    assert.equal(r.retryable, false);
    assert.match(r.error ?? "", /HTTP 400/);
  });

  it("creates an Instagram container, polls until FINISHED, then publishes", async () => {
    let polls = 0;
    handler = route({
      "POST graph.facebook.com/v21.0/ig1/media": () => json({ id: "container9" }),
      "GET graph.facebook.com/v21.0/container9": () => json({ status_code: ++polls < 3 ? "IN_PROGRESS" : "FINISHED" }),
      "POST graph.facebook.com/v21.0/ig1/media_publish": () => json({ id: "media77" }),
      "GET graph.facebook.com/v21.0/media77": () => json({ permalink: "https://www.instagram.com/p/abc/" }),
    });
    const r = await meta.publish(publishInput(ig, { mediaUrls: ["https://cdn.test/photo.jpg"] }), creds);
    assert.equal(r.ok, true, r.error ?? "");
    assert.equal(r.externalPostId, "media77");
    assert.equal(r.permalink, "https://www.instagram.com/p/abc/");
    assert.equal(polls, 3);
    assert.deepEqual(callsTo("/ig1/media", "POST")[0].json(), { caption: "Hello from the test suite", image_url: "https://cdn.test/photo.jpg" });
    assert.deepEqual(callsTo("/ig1/media_publish")[0].json(), { creation_id: "container9" });
    assert.ok(callsTo("/container9")[0].url.includes("fields=status_code"));
  });

  it("publishes a video URL as a Reel and fails cleanly when the container errors", async () => {
    handler = route({
      "POST graph.facebook.com/v21.0/ig1/media": () => json({ id: "container10" }),
      "GET graph.facebook.com/v21.0/container10": () => json({ status_code: "ERROR", status: "Media is too large" }),
    });
    const r = await meta.publish(publishInput(ig, { mediaUrls: ["https://cdn.test/clip.mp4"] }), creds);
    assert.equal(r.ok, false);
    assert.equal(r.retryable, false);
    assert.match(r.error ?? "", /too large/);
    assert.deepEqual(callsTo("/ig1/media", "POST")[0].json(), { caption: "Hello from the test suite", video_url: "https://cdn.test/clip.mp4", media_type: "REELS" });
    assert.equal(callsTo("/media_publish").length, 0);
  });

  it("gives up polling after the cap", async () => {
    const quick = createMetaProvider({ pollIntervalMs: 1, pollMaxMs: 5 });
    handler = route({
      "POST graph.facebook.com/v21.0/ig1/media": () => json({ id: "c" }),
      "GET graph.facebook.com/v21.0/c": () => json({ status_code: "IN_PROGRESS" }),
    });
    const r = await quick.publish(publishInput(ig, { mediaUrls: ["https://cdn.test/photo.jpg"] }), creds);
    assert.equal(r.ok, false);
    assert.equal(r.retryable, true);
    assert.match(r.error ?? "", /did not finish/);
  });

  it("reads Facebook comments and Messenger threads, dropping the page's own messages", async () => {
    handler = route({
      "GET graph.facebook.com/v21.0/page1/feed": () =>
        json({
          data: [
            {
              id: "post1",
              comments: {
                data: [
                  { id: "c1", from: { id: "user9", name: "Ada" }, message: "Love this", created_time: "2026-10-22T10:00:00+0000" },
                  { id: "c2", from: { id: "page1", name: "The Page" }, message: "Thanks!", created_time: "2026-10-22T11:00:00+0000" },
                  { id: "c0", from: { id: "user8", name: "Old" }, message: "stale", created_time: "2026-10-01T11:00:00+0000" },
                ],
              },
            },
          ],
        }),
      "GET graph.facebook.com/v21.0/page1/conversations": () =>
        json({
          data: [
            {
              id: "t_1",
              updated_time: "2026-10-23T09:00:00+0000",
              messages: {
                data: [
                  { id: "m2", from: { id: "page1", name: "The Page" }, message: "Hi Ada", created_time: "2026-10-23T09:00:00+0000" },
                  { id: "m1", from: { id: "user9", name: "Ada" }, message: "Are you open Sunday?", created_time: "2026-10-23T08:00:00+0000" },
                ],
              },
            },
          ],
        }),
    });
    const items = await meta.fetchInbox!(fb, creds, SINCE);
    assert.deepEqual(
      items.map((i) => [i.kind, i.externalId, i.threadId, i.authorName]),
      [
        ["COMMENT", "c1", "post1", "Ada"],
        ["DM", "m1", "t_1", "Ada"],
      ],
    );
    assert.equal(items[1].meta?.senderId, "user9");
    assert.ok(decodeURIComponent(callsTo("/page1/feed")[0].url).includes(`comments.since(${Math.floor(SINCE.getTime() / 1000)})`));
  });

  it("replies to a DM through the page's messages endpoint", async () => {
    handler = route({ "POST graph.facebook.com/v21.0/page1/messages": () => json({ message_id: "mid.1" }) });
    const r = await meta.reply!(fb, creds, { kind: "DM", threadId: "t_1", externalId: "m1", meta: { senderId: "user9", pageId: "page1" } }, "Yes, 10 to 4.");
    assert.equal(r.ok, true);
    assert.equal(r.externalId, "mid.1");
    assert.deepEqual(calls[0].json(), { recipient: { id: "user9" }, message: { text: "Yes, 10 to 4." }, messaging_type: "RESPONSE" });
  });

  it("replies to Instagram comments via /replies and Facebook comments via /comments", async () => {
    handler = route({
      "POST graph.facebook.com/v21.0/igc1/replies": () => json({ id: "igr1" }),
      "POST graph.facebook.com/v21.0/fbc1/comments": () => json({ id: "fbr1" }),
    });
    const a = await meta.reply!(ig, creds, { kind: "COMMENT", threadId: "m", externalId: "igc1" }, "Thanks");
    const b = await meta.reply!(fb, creds, { kind: "COMMENT", threadId: "p", externalId: "fbc1" }, "Thanks");
    assert.equal(a.externalId, "igr1");
    assert.equal(b.externalId, "fbr1");
  });

  it("collects page metrics and tolerates a failing insights call", async () => {
    handler = route({
      "GET graph.facebook.com/v21.0/page1/insights": () => json({ error: { message: "(#100) metric not supported" } }, 400),
      "GET graph.facebook.com/v21.0/page1": () => json({ followers_count: 1200, fan_count: 1100 }),
    });
    const m = await meta.fetchMetrics!(fb, creds);
    assert.equal(m.followers, 1200);
    assert.equal(m.reach, null);
    assert.equal(m.impressions, null);
    assert.equal(m.engagements, null);
  });

  it("asks for each page insight separately, so one retired metric does not take the others down", async () => {
    // Meta removed every page impressions/reach metric in late 2025; views (page_media_view) and engagements remain.
    handler = route({
      "GET graph.facebook.com/v21.0/page1/insights": (call) => {
        const metric = new URL(call.url).searchParams.get("metric");
        if (metric === "page_media_view") return json({ data: [{ name: "page_media_view", period: "day", values: [{ value: 31 }, { value: 40 }] }] });
        if (metric === "page_post_engagements") return json({ data: [{ name: "page_post_engagements", period: "day", values: [{ value: 2 }] }] });
        return json({ error: { message: "(#100) The value must be a valid insights metric" } }, 400);
      },
      "GET graph.facebook.com/v21.0/page1": () => json({ followers_count: 1918, fan_count: 1918 }),
    });
    const m = await meta.fetchMetrics!(fb, creds);
    assert.equal(m.followers, 1918);
    assert.equal(m.impressions, 40, "views are stored as impressions");
    assert.equal(m.engagements, 2);
    assert.equal(m.reach, null, "Facebook no longer reports page reach");
    const metrics = callsTo("/page1/insights").map((c) => new URL(c.url).searchParams.get("metric"));
    assert.deepEqual(metrics.sort(), ["page_media_view", "page_post_engagements"]);
    for (const c of callsTo("/page1/insights")) assert.equal(c.headers.authorization, "Bearer tok_live_abc");
  });

  it("maps Facebook ratings to reviews", async () => {
    handler = route({
      "GET graph.facebook.com/v21.0/page1/ratings": () =>
        json({ data: [{ reviewer: { id: "u1", name: "Ada" }, rating: 5, review_text: "Great", created_time: "2026-10-22T10:00:00+0000", open_graph_story: { id: "story1" } }] }),
    });
    const reviews = await meta.fetchReviews!(fb, creds, SINCE);
    assert.equal(reviews.length, 1);
    assert.deepEqual({ ...reviews[0], receivedAt: reviews[0].receivedAt.toISOString() }, { externalId: "story1", authorName: "Ada", rating: 5, body: "Great", url: "https://www.facebook.com/story1", receivedAt: "2026-10-22T10:00:00.000Z" });
  });
});

/* ---------- Google OAuth + Business Profile ---------- */

describe("google oauth helper", () => {
  before(() => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "gid";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "gsecret";
  });

  it("knows when a token is expired", () => {
    assert.equal(tokenExpired({ accessToken: "a" }), false);
    assert.equal(tokenExpired({ accessToken: "a", expiresAt: new Date(Date.now() - 1000).toISOString() }), true);
    assert.equal(tokenExpired({ accessToken: "a", expiresAt: new Date(Date.now() + 3_600_000).toISOString() }), false);
  });

  it("posts the refresh grant as a form and returns the new token with an expiry", async () => {
    handler = route({ "POST oauth2.googleapis.com/token": () => json({ access_token: "tok_new", expires_in: 3600, token_type: "Bearer" }) });
    const r = await refreshGoogleToken({ accessToken: "tok_old", refreshToken: "rt_1", expiresAt: "2020-01-01T00:00:00Z" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.creds.accessToken, "tok_new");
    assert.equal(r.creds.refreshToken, "rt_1");
    assert.ok(new Date(r.creds.expiresAt!).getTime() > Date.now() + 3_000_000);
    const form = calls[0].form();
    assert.equal(calls[0].headers["content-type"], "application/x-www-form-urlencoded");
    assert.deepEqual(Object.fromEntries(form), { client_id: "gid", client_secret: "gsecret", refresh_token: "rt_1", grant_type: "refresh_token" });
  });

  it("fails as a value without a refresh token", async () => {
    const r = await refreshGoogleToken({ accessToken: "x" });
    assert.equal(r.ok, false);
    assert.equal(calls.length, 0);
  });
});

describe("google business provider", () => {
  const gbp = createGoogleBusinessProvider();
  const ch = channel("GOOGLE_BUSINESS", "accounts/123/locations/456");

  before(() => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "gid";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "gsecret";
  });

  it("refreshes an expired token before publishing and uses the new one", async () => {
    handler = route({
      "POST oauth2.googleapis.com/token": () => json({ access_token: "tok_fresh", expires_in: 3600 }),
      "POST mybusiness.googleapis.com/v4/accounts/123/locations/456/localPosts": () => json({ name: "accounts/123/locations/456/localPosts/789", searchUrl: "https://local.google.com/place?id=1&use=posts&lpsid=789", state: "LIVE" }),
    });
    const expired: ChannelCredentials = { accessToken: "tok_old", refreshToken: "rt", expiresAt: new Date(Date.now() - 60_000).toISOString() };
    const r = await gbp.publish(publishInput(ch, { caption: "Spring tune-up offer", mediaUrls: ["https://cdn.test/hero.jpg"], link: "https://example.test/book" }), expired);
    assert.equal(r.ok, true, r.error ?? "");
    assert.equal(r.externalPostId, "accounts/123/locations/456/localPosts/789");
    assert.equal(r.permalink, "https://local.google.com/place?id=1&use=posts&lpsid=789");
    assert.equal(calls[0].url, "https://oauth2.googleapis.com/token");
    const post = calls[1];
    assert.equal(post.method, "POST");
    assert.equal(post.headers.authorization, "Bearer tok_fresh");
    assert.deepEqual(post.json(), {
      languageCode: "en",
      summary: "Spring tune-up offer",
      topicType: "STANDARD",
      media: [{ mediaFormat: "PHOTO", sourceUrl: "https://cdn.test/hero.jpg" }],
      callToAction: { actionType: "LEARN_MORE", url: "https://example.test/book" },
    });
  });

  it("does not refresh a token that is still valid", async () => {
    handler = route({ "POST mybusiness.googleapis.com/v4/accounts/123/locations/456/localPosts": () => json({ name: "accounts/123/locations/456/localPosts/1" }) });
    const r = await gbp.publish(publishInput(ch), { accessToken: "tok_ok", refreshToken: "rt", expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    assert.equal(r.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(r.permalink, null);
  });

  it("maps a 503 to a retryable failure", async () => {
    handler = () => json({ error: { code: 503, message: "The service is currently unavailable.", status: "UNAVAILABLE" } }, 503);
    const r = await gbp.publish(publishInput(ch), creds);
    assert.equal(r.ok, false);
    assert.equal(r.retryable, true);
    assert.match(r.error ?? "", /unavailable.*HTTP 503/);
  });

  it("maps reviews, converts star ratings and filters by since", async () => {
    handler = route({
      "GET mybusiness.googleapis.com/v4/accounts/123/locations/456/reviews": (call) => {
        assert.ok(call.url.endsWith("?pageSize=50"));
        return json({
          reviews: [
            { name: "accounts/123/locations/456/reviews/r1", reviewId: "r1", reviewer: { displayName: "Ada" }, starRating: "FIVE", comment: "Brilliant service", createTime: "2026-10-22T10:00:00Z" },
            { name: "accounts/123/locations/456/reviews/r2", reviewId: "r2", reviewer: { displayName: "Bo" }, starRating: "TWO", createTime: "2026-10-23T10:00:00Z" },
            { name: "accounts/123/locations/456/reviews/r0", reviewId: "r0", reviewer: { displayName: "Old" }, starRating: "ONE", createTime: "2026-09-01T10:00:00Z" },
          ],
        });
      },
    });
    const reviews = await gbp.fetchReviews!(ch, creds, SINCE);
    assert.deepEqual(
      reviews.map((r) => [r.externalId, r.authorName, r.rating, r.body]),
      [
        ["r1", "Ada", 5, "Brilliant service"],
        ["r2", "Bo", 2, null],
      ],
    );
    assert.equal(reviews[0].receivedAt.toISOString(), "2026-10-22T10:00:00.000Z");
  });

  it("replies to a review with PUT …/reply", async () => {
    handler = route({ "PUT mybusiness.googleapis.com/v4/accounts/123/locations/456/reviews/r1/reply": () => json({ comment: "Thank you", updateTime: "2026-10-24T00:00:00Z" }) });
    const r = await gbp.replyToReview!(ch, creds, "r1", "Thank you");
    assert.equal(r.ok, true);
    assert.equal(r.externalId, "r1");
    assert.deepEqual(calls[0].json(), { comment: "Thank you" });
  });

  it("sums impression metrics from the Performance API and returns {} on failure", async () => {
    handler = route({
      "GET businessprofileperformance.googleapis.com/v1/locations/456:fetchMultiDailyMetricsTimeSeries": (call) => {
        assert.ok(call.url.includes("dailyMetrics=WEBSITE_CLICKS"));
        assert.ok(call.url.includes("dailyRange.startDate.year="));
        return json({
          multiDailyMetricTimeSeries: [
            {
              dailyMetricTimeSeries: [
                { dailyMetric: "BUSINESS_IMPRESSIONS_DESKTOP_MAPS", timeSeries: { datedValues: [{ value: "40" }] } },
                { dailyMetric: "BUSINESS_IMPRESSIONS_MOBILE_MAPS", timeSeries: { datedValues: [{ value: "60" }] } },
                { dailyMetric: "WEBSITE_CLICKS", timeSeries: { datedValues: [{ value: "7" }] } },
              ],
            },
          ],
        });
      },
    });
    const m = await gbp.fetchMetrics!(ch, creds);
    assert.equal(m.impressions, 100);
    assert.equal(m.clicks, 7);

    handler = () => json({ error: { message: "forbidden" } }, 403);
    assert.deepEqual(await gbp.fetchMetrics!(ch, creds), {});
  });
});

/* ---------- LinkedIn ---------- */

describe("linkedin provider", () => {
  const li = createLinkedInProvider();
  const ch = channel("LINKEDIN", "urn:li:organization:123");

  it("posts with the versioned headers and reads the id from x-restli-id", async () => {
    handler = route({ "POST api.linkedin.com/rest/posts": () => new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:999" } }) });
    const r = await li.publish(publishInput(ch), creds);
    assert.equal(r.ok, true, r.error ?? "");
    assert.equal(r.externalPostId, "urn:li:share:999");
    assert.equal(r.permalink, "https://www.linkedin.com/feed/update/urn:li:share:999");
    const post = calls[0];
    assert.equal(post.headers.authorization, "Bearer tok_live_abc");
    assert.equal(post.headers["linkedin-version"], "202409");
    assert.equal(post.headers["x-restli-protocol-version"], "2.0.0");
    assert.deepEqual(post.json(), {
      author: "urn:li:organization:123",
      commentary: "Hello from the test suite",
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    });
  });

  it("initialises an image upload, PUTs the bytes and attaches the image urn", async () => {
    handler = route({
      "POST api.linkedin.com/rest/images": () => json({ value: { uploadUrl: "https://upload.linkedin.test/slot/1", image: "urn:li:image:C1" } }),
      "GET cdn.test/hero.jpg": () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "content-type": "image/jpeg" } }),
      "PUT upload.linkedin.test/slot/1": () => new Response(null, { status: 201 }),
      "POST api.linkedin.com/rest/posts": () => new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:ugcPost:5" } }),
    });
    const r = await li.publish(publishInput(ch, { mediaUrls: ["https://cdn.test/hero.jpg"] }), creds);
    assert.equal(r.ok, true, r.error ?? "");
    assert.ok(calls[0].url.endsWith("/rest/images?action=initializeUpload"));
    assert.deepEqual(calls[0].json(), { initializeUploadRequest: { owner: "urn:li:organization:123" } });
    const put = callsTo("upload.linkedin.test", "PUT")[0];
    assert.ok(put.body instanceof Uint8Array && put.body.byteLength === 4);
    const post = callsTo("/rest/posts")[0].json() as { content?: { media?: { id?: string } } };
    assert.equal(post.content?.media?.id, "urn:li:image:C1");
  });

  it("maps a 500 to a retryable failure and a 401 to a final one", async () => {
    handler = () => json({ message: "Internal error", status: 500 }, 500);
    const a = await li.publish(publishInput(ch), creds);
    assert.equal(a.ok, false);
    assert.equal(a.retryable, true);
    assert.match(a.error ?? "", /Internal error \(HTTP 500\)/);
    handler = () => json({ message: "Expired token", status: 401 }, 401);
    const b = await li.publish(publishInput(ch), creds);
    assert.equal(b.retryable, false);
  });

  it("reads the follower count from networkSizes and returns {} otherwise", async () => {
    handler = route({ "GET api.linkedin.com/rest/networkSizes/urn%3Ali%3Aorganization%3A123": () => json({ firstDegreeSize: 4321 }) });
    assert.equal((await li.fetchMetrics!(ch, creds)).followers, 4321);
    assert.ok(calls[0].url.includes("edgeType=COMPANY_FOLLOWED_BY_MEMBER"));
    handler = () => json({ message: "nope" }, 403);
    assert.deepEqual(await li.fetchMetrics!(ch, creds), {});
  });
});

/* ---------- YouTube ---------- */

describe("youtube provider", () => {
  const yt = createYouTubeProvider();
  const ch = channel("YOUTUBE", "UC_channel1", { privacyStatus: "unlisted" });

  before(() => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "gid";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "gsecret";
  });

  it("builds a multipart/related body with the JSON part and the media bytes", () => {
    const { body, contentType } = multipartRelated({ snippet: { title: "T" } }, new Uint8Array([0xde, 0xad]), "video/mp4");
    const boundary = contentType.replace("multipart/related; boundary=", "");
    const text = new TextDecoder("latin1").decode(body);
    assert.ok(text.startsWith(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{"snippet":{"title":"T"}}\r\n--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`));
    assert.ok(text.endsWith(`\r\n--${boundary}--\r\n`));
    assert.ok(body.includes(0xde) && body.includes(0xad));
  });

  it("downloads the video and uploads it with snippet, status and the bytes", async () => {
    const videoBytes = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
    handler = route({
      "GET cdn.test/clip.mp4": () => new Response(videoBytes, { status: 200, headers: { "content-type": "video/mp4", "content-length": String(videoBytes.length) } }),
      "POST www.googleapis.com/upload/youtube/v3/videos": () => json({ id: "vid123" }),
    });
    const r = await yt.publish(publishInput(ch, { caption: "Why we service boilers in autumn #heating #tips\nMore detail here.", mediaUrls: ["https://cdn.test/clip.mp4"] }), creds);
    assert.equal(r.ok, true, r.error ?? "");
    assert.equal(r.externalPostId, "vid123");
    assert.equal(r.permalink, "https://www.youtube.com/watch?v=vid123");
    const upload = callsTo("upload/youtube/v3/videos")[0];
    assert.equal(upload.method, "POST");
    assert.ok(upload.url.includes("part=snippet,status") && upload.url.includes("uploadType=multipart"));
    assert.equal(upload.headers.authorization, "Bearer tok_live_abc");
    assert.match(upload.headers["content-type"], /^multipart\/related; boundary=/);
    assert.ok(upload.body instanceof Uint8Array);
    const text = new TextDecoder("latin1").decode(upload.body as Uint8Array);
    const jsonPart = text.slice(text.indexOf("{"), text.indexOf("}}") + 2);
    assert.deepEqual(JSON.parse(jsonPart), {
      snippet: { title: "Why we service boilers in autumn #heating #tips", description: "Why we service boilers in autumn #heating #tips\nMore detail here.", tags: ["heating", "tips"] },
      status: { privacyStatus: "unlisted", selfDeclaredMadeForKids: false },
    });
    assert.ok(text.includes("Content-Type: video/mp4\r\n\r\n\u0000\u0000\u0000\u0018ftyp"), "the media bytes follow the video part header");
  });

  it("refuses without exactly one video and refuses oversized downloads before uploading", async () => {
    const none = await yt.publish(publishInput(ch), creds);
    assert.equal(none.ok, false);
    assert.match(none.error ?? "", /exactly one video/);
    assert.equal(calls.length, 0);

    handler = route({ "GET cdn.test/huge.mp4": () => new Response(new Uint8Array(8), { status: 200, headers: { "content-type": "video/mp4", "content-length": String(300 * 1024 * 1024) } }) });
    const big = await yt.publish(publishInput(ch, { mediaUrls: ["https://cdn.test/huge.mp4"] }), creds);
    assert.equal(big.ok, false);
    assert.equal(big.retryable, false);
    assert.match(big.error ?? "", /300 MB.*256 MB/);
    assert.equal(callsTo("upload/youtube").length, 0);
  });

  it("maps an upload quota error with its status", async () => {
    handler = route({
      "GET cdn.test/clip.mp4": () => new Response(new Uint8Array([1]), { status: 200, headers: { "content-type": "video/mp4" } }),
      "POST www.googleapis.com/upload/youtube/v3/videos": () => json({ error: { code: 403, message: "The user has exceeded the number of videos they may upload." } }, 403),
    });
    const r = await yt.publish(publishInput(ch, { mediaUrls: ["https://cdn.test/clip.mp4"] }), creds);
    assert.equal(r.ok, false);
    assert.equal(r.retryable, false);
    assert.match(r.error ?? "", /exceeded.*HTTP 403/);
  });

  it("reads channel statistics and comment threads, stripping HTML", async () => {
    handler = route({
      "GET www.googleapis.com/youtube/v3/channels": () => json({ items: [{ statistics: { subscriberCount: "1500", viewCount: "98765", videoCount: "42" } }] }),
      "GET www.googleapis.com/youtube/v3/commentThreads": (call) => {
        assert.ok(call.url.includes("allThreadsRelatedToChannelId=UC_channel1") && call.url.includes("order=time"));
        return json({
          items: [
            { id: "th1", snippet: { videoId: "vid1", topLevelComment: { id: "cm1", snippet: { authorDisplayName: "Ada", authorChannelId: { value: "UC_ada" }, textDisplay: "Great <b>video</b>&amp;thanks<br>!", publishedAt: "2026-10-22T10:00:00Z", videoId: "vid1" } } } },
            { id: "th0", snippet: { videoId: "vid1", topLevelComment: { id: "cm0", snippet: { authorDisplayName: "Old", textDisplay: "stale", publishedAt: "2026-09-01T10:00:00Z" } } } },
          ],
        });
      },
    });
    const m = await yt.fetchMetrics!(ch, creds);
    assert.deepEqual([m.followers, m.impressions, m.posts], [1500, 98765, 42]);
    const inbox = await yt.fetchInbox!(ch, creds, SINCE);
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].text, "Great video&thanks\n!");
    assert.equal(inbox[0].threadId, "vid1");
    assert.equal(inbox[0].externalId, "cm1");
  });

  it("replies to a comment with parentId and textOriginal", async () => {
    handler = route({ "POST www.googleapis.com/youtube/v3/comments": () => json({ id: "reply1" }) });
    const r = await yt.reply!(ch, creds, { kind: "COMMENT", threadId: "vid1", externalId: "cm1" }, "Thanks Ada");
    assert.equal(r.ok, true);
    assert.equal(r.externalId, "reply1");
    assert.ok(calls[0].url.endsWith("/comments?part=snippet"));
    assert.deepEqual(calls[0].json(), { snippet: { parentId: "cm1", textOriginal: "Thanks Ada" } });
  });
});

/* ---------- TikTok ---------- */

describe("tiktok provider", () => {
  const tt = createTikTokProvider({ pollIntervalMs: 1, pollMaxMs: 500 });
  const ch = channel("TIKTOK", "open_id_1", { privacyLevel: "SELF_ONLY" });

  before(() => {
    process.env.TIKTOK_CLIENT_KEY = "ck";
    process.env.TIKTOK_CLIENT_SECRET = "cs";
  });

  it("initialises a pull-from-url post and polls until PUBLISH_COMPLETE", async () => {
    let polls = 0;
    handler = route({
      "POST open.tiktokapis.com/v2/post/publish/video/init/": () => json({ data: { publish_id: "v_pub_1" }, error: { code: "ok", message: "", log_id: "l1" } }),
      "POST open.tiktokapis.com/v2/post/publish/status/fetch/": () => {
        polls++;
        if (polls < 3) return json({ data: { status: "PROCESSING_DOWNLOAD" }, error: { code: "ok" } });
        // TikTok sends the id as a bare 19-digit integer, which JSON.parse would round.
        return new Response('{"data":{"status":"PUBLISH_COMPLETE","publicaly_available_post_id":[7300000000000000001]},"error":{"code":"ok"}}', { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    const r = await tt.publish(publishInput(ch, { mediaUrls: ["https://cdn.test/clip.mp4"] }), creds);
    assert.equal(r.ok, true, r.error ?? "");
    assert.equal(r.externalPostId, "7300000000000000001", "the 19-digit id survives intact");
    assert.equal(polls, 3);
    const init = calls[0];
    assert.equal(init.headers.authorization, "Bearer tok_live_abc");
    assert.match(init.headers["content-type"], /^application\/json/);
    assert.deepEqual(init.json(), {
      post_info: { title: "Hello from the test suite", privacy_level: "SELF_ONLY", disable_duet: false, disable_comment: false, disable_stitch: false },
      source_info: { source: "PULL_FROM_URL", video_url: "https://cdn.test/clip.mp4" },
    });
    assert.deepEqual(callsTo("/status/fetch/")[0].json(), { publish_id: "v_pub_1" });
  });

  it("falls back to the publish id when no public post id is returned", async () => {
    handler = route({
      "POST open.tiktokapis.com/v2/post/publish/video/init/": () => json({ data: { publish_id: "v_pub_2" }, error: { code: "ok" } }),
      "POST open.tiktokapis.com/v2/post/publish/status/fetch/": () => json({ data: { status: "PUBLISH_COMPLETE" }, error: { code: "ok" } }),
    });
    const r = await tt.publish(publishInput(ch, { mediaUrls: ["https://cdn.test/clip.mp4"] }), creds);
    assert.equal(r.externalPostId, "v_pub_2");
  });

  it("reports FAILED with the fail reason and treats a 200 with an error code as a failure", async () => {
    handler = route({
      "POST open.tiktokapis.com/v2/post/publish/video/init/": () => json({ data: { publish_id: "v_pub_3" }, error: { code: "ok" } }),
      "POST open.tiktokapis.com/v2/post/publish/status/fetch/": () => json({ data: { status: "FAILED", fail_reason: "video_pull_failed" }, error: { code: "ok" } }),
    });
    const failed = await tt.publish(publishInput(ch, { mediaUrls: ["https://cdn.test/clip.mp4"] }), creds);
    assert.equal(failed.ok, false);
    assert.equal(failed.retryable, false);
    assert.match(failed.error ?? "", /video_pull_failed/);

    handler = () => json({ data: {}, error: { code: "url_ownership_unverified", message: "The URL's domain is not verified", log_id: "x" } });
    const unverified = await tt.publish(publishInput(ch, { mediaUrls: ["https://cdn.test/clip.mp4"] }), creds);
    assert.equal(unverified.ok, false);
    assert.match(unverified.error ?? "", /not verified \(TikTok url_ownership_unverified, HTTP 200\)/);

    handler = () => json({ error: { code: "rate_limit_exceeded", message: "slow down" } }, 429);
    const limited = await tt.publish(publishInput(ch, { mediaUrls: ["https://cdn.test/clip.mp4"] }), creds);
    assert.equal(limited.retryable, true);
    assert.match(limited.error ?? "", /HTTP 429/);
  });

  it("refreshes the token with the client key and secret as a form", async () => {
    handler = route({ "POST open.tiktokapis.com/v2/oauth/token/": () => json({ access_token: "tok_new", expires_in: 86400, refresh_token: "rt_new", refresh_expires_in: 31536000, open_id: "open_id_1", scope: "video.publish" }) });
    const r = await tt.refreshCredentials!({ accessToken: "tok_old", refreshToken: "rt_old" });
    assert.ok(r);
    assert.equal(r!.accessToken, "tok_new");
    assert.equal(r!.refreshToken, "rt_new");
    assert.ok(new Date(r!.expiresAt!).getTime() > Date.now());
    assert.deepEqual(Object.fromEntries(calls[0].form()), { client_key: "ck", client_secret: "cs", grant_type: "refresh_token", refresh_token: "rt_old" });
  });

  it("refreshes an expired token before publishing", async () => {
    handler = route({
      "POST open.tiktokapis.com/v2/oauth/token/": () => json({ access_token: "tok_fresh", expires_in: 86400 }),
      "POST open.tiktokapis.com/v2/post/publish/video/init/": () => json({ data: { publish_id: "p" }, error: { code: "ok" } }),
      "POST open.tiktokapis.com/v2/post/publish/status/fetch/": () => json({ data: { status: "PUBLISH_COMPLETE" }, error: { code: "ok" } }),
    });
    const r = await tt.publish(publishInput(ch, { mediaUrls: ["https://cdn.test/clip.mp4"] }), { accessToken: "tok_old", refreshToken: "rt", expiresAt: new Date(Date.now() - 1).toISOString() });
    assert.equal(r.ok, true, r.error ?? "");
    assert.equal(calls[0].url, "https://open.tiktokapis.com/v2/oauth/token/");
    assert.equal(calls[1].headers.authorization, "Bearer tok_fresh");
  });

  it("reads follower counts from user info", async () => {
    handler = route({ "GET open.tiktokapis.com/v2/user/info/": () => json({ data: { user: { follower_count: 900, likes_count: 12000, video_count: 31 } }, error: { code: "ok" } }) });
    const m = await tt.fetchMetrics!(ch, creds);
    assert.deepEqual([m.followers, m.engagements, m.posts], [900, 12000, 31]);
    assert.ok(calls[0].url.includes("fields=follower_count%2Clikes_count%2Cvideo_count") || calls[0].url.includes("fields=follower_count,likes_count,video_count"));
  });
});

/* ---------- registry ---------- */

describe("built-in registration", () => {
  it("registers every adapter once and leaves demo mode alone", () => {
    const prev = process.env.SOCIAL_MODE;
    delete process.env.SOCIAL_MODE;
    try {
      registerBuiltInProviders();
      registerBuiltInProviders();
      assert.equal(socialProviderFor("FACEBOOK").name, "meta");
      assert.equal(socialProviderFor("INSTAGRAM").name, "meta");
      assert.equal(socialProviderFor("GOOGLE_BUSINESS").name, "google-business");
      assert.equal(socialProviderFor("LINKEDIN").name, "linkedin");
      assert.equal(socialProviderFor("YOUTUBE").name, "youtube");
      assert.equal(socialProviderFor("TIKTOK").name, "tiktok");
      assert.equal(hasRealProvider("TIKTOK"), true);
      process.env.SOCIAL_MODE = "log";
      assert.equal(socialProviderFor("TIKTOK").name, "log");
      assert.equal(hasRealProvider("TIKTOK"), false);
    } finally {
      if (prev === undefined) delete process.env.SOCIAL_MODE;
      else process.env.SOCIAL_MODE = prev;
    }
  });
});
