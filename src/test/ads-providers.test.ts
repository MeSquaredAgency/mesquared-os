import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { registerBuiltInAdsProviders } from "@/lib/ads/providers/builtin";
import { createGoogleAdsProvider, googleAdsErrorText, googleCustomerId, microsToCents, spendQuery } from "@/lib/ads/providers/google";
import { adsProviderFor, hasRealAdsProvider } from "@/lib/ads/providers/index";
import { createMetaAdsProvider, metaAccountPath, metaLeadsFromActions, metaSpendToCents } from "@/lib/ads/providers/meta";
import type { AdsCredentials } from "@/lib/ads/providers/types";
import type { AdAccountRecord, AdPlatform } from "@/lib/types";

/* ---------- fetch stub ---------- */

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  json(): Record<string, unknown>;
  form(): URLSearchParams;
}

type Handler = (call: RecordedCall) => Response | Promise<Response>;

let calls: RecordedCall[] = [];
let handler: Handler = () => json({}, 404);
const realFetch = globalThis.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
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
  const body = typeof rawBody === "string" ? rawBody : rawBody instanceof URLSearchParams ? rawBody.toString() : null;
  const call: RecordedCall = {
    url,
    method: (init?.method ?? "GET").toUpperCase(),
    headers: headerRecord(init?.headers),
    body,
    json() {
      return JSON.parse(body ?? "{}") as Record<string, unknown>;
    },
    form() {
      return new URLSearchParams(body ?? "");
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

/* ---------- fixtures ---------- */

function account(platform: AdPlatform, externalAccountId: string, currency = "AUD"): AdAccountRecord {
  return { id: `ad_${platform.toLowerCase()}`, tenantId: "t1", platform, externalAccountId, name: null, currency, monthlyBudgetCents: null, isActive: true, lastSyncAt: null, lastError: null, settings: {} };
}

const RANGE = { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-10-03T00:00:00Z") };
const TOKEN = "tok_ads_secret";
const creds: AdsCredentials = { accessToken: TOKEN };

const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ["META_GRAPH_VERSION", "GOOGLE_ADS_API_VERSION", "GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "ADS_MODE"];

before(() => {
  globalThis.fetch = recordedFetch as typeof fetch;
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
});

after(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

beforeEach(() => {
  calls = [];
  handler = () => json({}, 404);
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

/* ---------- Meta ---------- */

describe("meta ads provider", () => {
  const meta = createMetaAdsProvider();

  it("normalises the ad account id and converts spend/leads", () => {
    assert.equal(metaAccountPath("123"), "act_123");
    assert.equal(metaAccountPath("act_123"), "act_123");
    assert.equal(metaSpendToCents("12.345"), 1235);
    assert.equal(metaSpendToCents("0"), 0);
    assert.equal(metaLeadsFromActions(undefined), null);
    assert.equal(metaLeadsFromActions([{ action_type: "link_click", value: "40" }]), 0);
    assert.equal(
      metaLeadsFromActions([
        { action_type: "lead", value: "2" },
        { action_type: "onsite_conversion.lead_grouped", value: "1" },
        { action_type: "offsite_conversion.fb_pixel_lead", value: 3 },
        { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "1" },
        { action_type: "post_engagement", value: "99" },
      ]),
      7,
    );
  });

  it("requests campaign-level daily insights with the token in the header, follows paging and maps rows", async () => {
    handler = route({
      "GET graph.facebook.com/v21.0/act_555/insights": (call) => {
        const u = new URL(call.url);
        if (u.searchParams.get("after") === "cursor2") {
          return json({
            data: [{ date_start: "2026-10-02", date_stop: "2026-10-02", campaign_id: "c1", campaign_name: "Leads", spend: "5.5", impressions: "100", clicks: "7", actions: [{ action_type: "lead", value: "1" }], account_currency: "AUD" }],
          });
        }
        return json({
          data: [{ date_start: "2026-10-01", date_stop: "2026-10-01", campaign_id: "c1", campaign_name: "Leads", spend: "12.34", impressions: "1500", clicks: "40", actions: [{ action_type: "lead", value: "2" }, { action_type: "offsite_conversion.fb_pixel_lead", value: "1" }, { action_type: "link_click", value: "40" }], account_currency: "AUD" }],
          paging: { cursors: { after: "cursor2" }, next: `https://graph.facebook.com/v21.0/act_555/insights?access_token=${TOKEN}&after=cursor2&limit=500` },
        });
      },
    });
    const r = await meta.fetchDailySpend(account("META", "555"), creds, RANGE);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.data.length, 2);
    assert.deepEqual(r.data[0], { date: "2026-10-01", campaignId: "c1", campaignName: "Leads", spendCents: 1234, impressions: 1500, clicks: 40, leads: 3, currency: "AUD" });
    assert.equal(r.data[1].spendCents, 550);
    assert.equal(r.data[1].leads, 1);

    assert.equal(calls.length, 2);
    const first = new URL(calls[0].url);
    assert.equal(first.origin + first.pathname, "https://graph.facebook.com/v21.0/act_555/insights");
    assert.equal(first.searchParams.get("fields"), "spend,impressions,clicks,actions,campaign_id,campaign_name,account_currency");
    assert.equal(first.searchParams.get("level"), "campaign");
    assert.equal(first.searchParams.get("time_increment"), "1");
    assert.equal(first.searchParams.get("limit"), "500");
    assert.deepEqual(JSON.parse(first.searchParams.get("time_range")!), { since: "2026-10-01", until: "2026-10-03" });
    assert.equal(calls[0].headers.authorization, `Bearer ${TOKEN}`);
    for (const c of calls) assert.ok(!c.url.includes(TOKEN), "token must never travel in the URL (including paging.next)");
    assert.equal(new URL(calls[1].url).searchParams.get("after"), "cursor2");
  });

  it("caps paging at 20 pages", async () => {
    handler = route({
      "GET graph.facebook.com/v21.0/act_1/insights": () => json({ data: [{ date_start: "2026-10-01", spend: "1" }], paging: { next: "https://graph.facebook.com/v21.0/act_1/insights?after=x" } }),
    });
    const r = await meta.fetchDailySpend(account("META", "act_1"), creds, RANGE);
    assert.equal(r.ok, true);
    assert.equal(calls.length, 20);
  });

  it("fetches the account name and currency", async () => {
    handler = route({ "GET graph.facebook.com/v21.0/act_9": () => json({ name: "Fictional Plumbing Ads", currency: "AUD", id: "act_9" }) });
    const r = await meta.fetchAccount!(account("META", "9"), creds);
    assert.deepEqual(r, { ok: true, data: { name: "Fictional Plumbing Ads", currency: "AUD" } });
    assert.equal(new URL(calls[0].url).searchParams.get("fields"), "name,currency");
  });

  it("honours META_GRAPH_VERSION", async () => {
    process.env.META_GRAPH_VERSION = "v22.0";
    handler = route({ "GET graph.facebook.com/v22.0/act_9": () => json({ name: "x", currency: "USD" }) });
    const r = await meta.fetchAccount!(account("META", "9"), creds);
    assert.equal(r.ok, true);
  });

  it("maps an expired token (code 190) to a non-retryable error and a 429 to a retryable one", async () => {
    handler = route({ "GET graph.facebook.com/v21.0/act_1/insights": () => json({ error: { message: "Error validating access token: Session has expired", type: "OAuthException", code: 190 } }, 400) });
    const r = await meta.fetchDailySpend(account("META", "1"), creds, RANGE);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.retryable, false);
    assert.match(r.error, /Session has expired \(HTTP 400\)/);
    assert.ok(!r.error.includes(TOKEN));

    handler = route({ "GET graph.facebook.com/v21.0/act_1/insights": () => json({ error: { message: "Too many calls", code: 80004 } }, 429) });
    const r2 = await meta.fetchDailySpend(account("META", "1"), creds, RANGE);
    assert.equal(r2.ok, false);
    if (r2.ok) return;
    assert.equal(r2.retryable, true);
    assert.match(r2.error, /HTTP 429/);

    handler = route({ "GET graph.facebook.com/v21.0/act_1/insights": () => json({ error: { message: "Application request limit reached", code: 4 } }, 400) });
    const r3 = await meta.fetchDailySpend(account("META", "1"), creds, RANGE);
    assert.equal(r3.ok, false);
    if (r3.ok) return;
    assert.equal(r3.retryable, true, "Graph rate-limit code 4 is retryable even on HTTP 400");
  });

  it("returns a retryable failure on a network error instead of throwing", async () => {
    handler = () => {
      throw new TypeError("fetch failed");
    };
    const r = await meta.fetchDailySpend(account("META", "1"), creds, RANGE);
    assert.deepEqual(r, { ok: false, error: "Network error: fetch failed", retryable: true });
  });
});

/* ---------- Google Ads ---------- */

describe("google ads provider", () => {
  const google = createGoogleAdsProvider();
  const gcreds: AdsCredentials = { accessToken: TOKEN, developerToken: "dev-token-1", loginCustomerId: "999-888-7777" };

  it("strips dashes, converts micros and builds the GAQL query", () => {
    assert.equal(googleCustomerId("123-456-7890"), "1234567890");
    assert.equal(microsToCents("12340000"), 1234);
    assert.equal(microsToCents(5_005_000), 501);
    assert.equal(
      spendQuery(RANGE.from, RANGE.to),
      "SELECT segments.date, campaign.id, campaign.name, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date BETWEEN '2026-10-01' AND '2026-10-03' AND campaign.status != 'REMOVED'",
    );
  });

  it("posts the search with developer-token and login-customer-id headers, pages with nextPageToken and maps rows", async () => {
    handler = route({
      "POST googleads.googleapis.com/v18/customers/1234567890/googleAds:search": (call) => {
        const body = call.json();
        if (body.pageToken === "p2") {
          return json({ results: [{ campaign: { id: "22", name: "Brand" }, metrics: { costMicros: "1000000", impressions: "10", clicks: "1", conversions: 0 }, segments: { date: "2026-10-02" } }] });
        }
        return json({
          results: [{ campaign: { id: "11", name: "Leads", resourceName: "customers/1234567890/campaigns/11" }, metrics: { costMicros: "12345678", impressions: "2000", clicks: "55", conversions: 2.6 }, segments: { date: "2026-10-01" } }],
          nextPageToken: "p2",
        });
      },
    });
    const r = await google.fetchDailySpend(account("GOOGLE_ADS", "123-456-7890"), gcreds, RANGE);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.data.length, 2);
    assert.deepEqual(r.data[0], { date: "2026-10-01", campaignId: "11", campaignName: "Leads", spendCents: 1235, impressions: 2000, clicks: 55, leads: 3, currency: "AUD" });
    assert.equal(r.data[1].spendCents, 100);

    assert.equal(calls.length, 2);
    const first = calls[0];
    assert.equal(first.method, "POST");
    assert.equal(first.url, "https://googleads.googleapis.com/v18/customers/1234567890/googleAds:search");
    assert.equal(first.headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(first.headers["developer-token"], "dev-token-1");
    assert.equal(first.headers["login-customer-id"], "9998887777");
    assert.equal(first.headers["content-type"], "application/json");
    assert.equal(first.json().query, spendQuery(RANGE.from, RANGE.to));
    assert.equal(first.json().pageToken, undefined);
    assert.equal(calls[1].json().pageToken, "p2");
    for (const c of calls) assert.ok(!c.url.includes(TOKEN));
  });

  it("falls back to GOOGLE_ADS_DEVELOPER_TOKEN and omits login-customer-id when there is no manager", async () => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "env-dev-token";
    handler = route({ "POST googleads.googleapis.com/v18/customers/1/googleAds:search": () => json({ results: [{ customer: { descriptiveName: "Fictional Roofing", currencyCode: "AUD" } }] }) });
    const r = await google.fetchAccount!(account("GOOGLE_ADS", "1"), { accessToken: TOKEN });
    assert.deepEqual(r, { ok: true, data: { name: "Fictional Roofing", currency: "AUD" } });
    assert.equal(calls[0].headers["developer-token"], "env-dev-token");
    assert.equal("login-customer-id" in calls[0].headers, false);
    assert.equal(calls[0].json().query, "SELECT customer.descriptive_name, customer.currency_code FROM customer");
  });

  it("fails without a developer token before making any request", async () => {
    const r = await google.fetchDailySpend(account("GOOGLE_ADS", "1"), { accessToken: TOKEN }, RANGE);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.retryable, false);
    assert.equal(calls.length, 0);
  });

  it("caps paging at 20 pages", async () => {
    handler = route({ "POST googleads.googleapis.com/v18/customers/1/googleAds:search": () => json({ results: [], nextPageToken: "again" }) });
    const r = await google.fetchDailySpend(account("GOOGLE_ADS", "1"), gcreds, RANGE);
    assert.equal(r.ok, true);
    assert.equal(calls.length, 20);
  });

  it("surfaces the innermost Google Ads error message with the HTTP status and retryable flag", async () => {
    const body = {
      error: {
        code: 400,
        message: "Request contains an invalid argument.",
        status: "INVALID_ARGUMENT",
        details: [{ "@type": "type.googleapis.com/google.ads.googleads.v18.errors.GoogleAdsFailure", errors: [{ errorCode: { queryError: "UNRECOGNIZED_FIELD" }, message: "Unrecognized field in the query: 'metrics.bogus'." }] }],
      },
    };
    assert.equal(googleAdsErrorText(400, body, "fallback"), "Unrecognized field in the query: 'metrics.bogus'. (HTTP 400)");
    handler = route({ "POST googleads.googleapis.com/v18/customers/1/googleAds:search": () => json(body, 400) });
    const r = await google.fetchDailySpend(account("GOOGLE_ADS", "1"), gcreds, RANGE);
    assert.deepEqual(r, { ok: false, error: "Unrecognized field in the query: 'metrics.bogus'. (HTTP 400)", retryable: false });

    handler = route({ "POST googleads.googleapis.com/v18/customers/1/googleAds:search": () => json({ error: { message: "Request had invalid authentication credentials.", status: "UNAUTHENTICATED" } }, 401) });
    const r2 = await google.fetchDailySpend(account("GOOGLE_ADS", "1"), gcreds, RANGE);
    assert.equal(r2.ok, false);
    if (!r2.ok) assert.equal(r2.retryable, false);

    handler = route({ "POST googleads.googleapis.com/v18/customers/1/googleAds:search": () => json({ error: { message: "backend error" } }, 503) });
    const r3 = await google.fetchDailySpend(account("GOOGLE_ADS", "1"), gcreds, RANGE);
    assert.equal(r3.ok, false);
    if (!r3.ok) assert.equal(r3.retryable, true);
  });

  it("refreshes an expired token before the report call and uses the new one", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "cid";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "csecret";
    handler = route({
      "POST oauth2.googleapis.com/token": () => json({ access_token: "tok_new", expires_in: 3600, token_type: "Bearer" }),
      "POST googleads.googleapis.com/v18/customers/1/googleAds:search": () => json({ results: [] }),
    });
    const expired: AdsCredentials = { ...gcreds, accessToken: "tok_old", refreshToken: "rt_1", expiresAt: new Date(Date.now() - 60_000).toISOString() };
    const r = await google.fetchDailySpend(account("GOOGLE_ADS", "1"), expired, RANGE);
    assert.equal(r.ok, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, "https://oauth2.googleapis.com/token");
    const form = calls[0].form();
    assert.equal(form.get("grant_type"), "refresh_token");
    assert.equal(form.get("refresh_token"), "rt_1");
    assert.equal(form.get("client_id"), "cid");
    assert.equal(calls[1].headers.authorization, "Bearer tok_new");
    assert.equal(calls[1].headers["developer-token"], "dev-token-1");
  });

  it("does not refresh a token that is still valid", async () => {
    handler = route({ "POST googleads.googleapis.com/v18/customers/1/googleAds:search": () => json({ results: [] }) });
    const r = await google.fetchDailySpend(account("GOOGLE_ADS", "1"), { ...gcreds, refreshToken: "rt", expiresAt: new Date(Date.now() + 3_600_000).toISOString() }, RANGE);
    assert.equal(r.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers.authorization, `Bearer ${TOKEN}`);
  });

  it("refreshCredentials returns the new credentials, keeping the developer token, or null when it cannot refresh", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "cid";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "csecret";
    handler = route({ "POST oauth2.googleapis.com/token": () => json({ access_token: "tok_new2", expires_in: 1800 }) });
    const r = await google.refreshCredentials!({ ...gcreds, refreshToken: "rt" });
    assert.ok(r);
    assert.equal(r!.accessToken, "tok_new2");
    assert.equal(r!.developerToken, "dev-token-1");
    assert.equal(r!.refreshToken, "rt");
    assert.ok(new Date(r!.expiresAt!).getTime() > Date.now());
    assert.equal(await google.refreshCredentials!({ accessToken: "x" }), null);
  });
});

/* ---------- registry ---------- */

describe("built-in ads providers", () => {
  it("registers Meta and Google Ads once and the registry hands them out", () => {
    registerBuiltInAdsProviders();
    registerBuiltInAdsProviders();
    assert.equal(hasRealAdsProvider("META"), true);
    assert.equal(hasRealAdsProvider("GOOGLE_ADS"), true);
    assert.equal(adsProviderFor("META").name, "meta-ads");
    assert.equal(adsProviderFor("GOOGLE_ADS").name, "google-ads");
    process.env.ADS_MODE = "log";
    assert.equal(adsProviderFor("META").name, "log");
    assert.equal(hasRealAdsProvider("META"), false);
  });
});
