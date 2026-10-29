import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { decryptSecret } from "@/lib/crypto";
import { repository } from "@/lib/data";
import { connectMetaChannels, exchangeForLongLivedUserToken, inspectToken, listManagedPages, metaIntegrationAccountId, PAGE_WEBHOOK_FIELDS, subscribePageToApp } from "@/lib/social/meta-connect";
import { provisionTenant } from "@/lib/tenants/provision";
import type { TenantSummary } from "@/lib/types";

/* ---------- fetch stub (same shape as social-providers.test.ts) ---------- */

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

let calls: RecordedCall[] = [];
let handler: (call: RecordedCall) => Response = () => json({}, 404);
const realFetch = globalThis.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function recordedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries((init?.headers as Record<string, string>) ?? {})) headers[k.toLowerCase()] = v;
  const call: RecordedCall = { url, method: (init?.method ?? "GET").toUpperCase(), headers, body: typeof init?.body === "string" ? init.body : null };
  calls.push(call);
  return handler(call);
}

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

/* ---------- Graph calls ---------- */

describe("Meta connect: token exchange and page discovery", () => {
  it("exchanges a short-lived user token for a long-lived one", async () => {
    handler = (c) => (c.url.includes("/oauth/access_token") ? json({ access_token: "LL_USER", token_type: "bearer", expires_in: 5_183_944 }) : json({}, 404));
    const r = await exchangeForLongLivedUserToken("SHORT", "1142218158486204", "app-secret");
    assert.ok(r.ok);
    assert.equal(r.value.accessToken, "LL_USER");
    assert.equal(r.value.expiresInSeconds, 5_183_944);
    const u = new URL(calls[0].url);
    assert.equal(u.searchParams.get("grant_type"), "fb_exchange_token");
    assert.equal(u.searchParams.get("client_id"), "1142218158486204");
    assert.equal(u.searchParams.get("client_secret"), "app-secret");
    assert.equal(u.searchParams.get("fb_exchange_token"), "SHORT");
  });

  it("reports a failed exchange as a value with the provider's message", async () => {
    handler = () => json({ error: { message: "Error validating application. Invalid application ID." } }, 400);
    const r = await exchangeForLongLivedUserToken("SHORT", "bad", "secret");
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /Invalid application ID.*HTTP 400/);
  });

  it("lists the pages the user manages with their page tokens and linked Instagram accounts", async () => {
    handler = (c) =>
      c.url.includes("/me/accounts")
        ? json({
            data: [
              { id: "111", name: "Adelaide Property Network", access_token: "PAGE_111", instagram_business_account: { id: "178", username: "adelaidepropertynetwork" } },
              { id: "222", name: "Side page", access_token: "PAGE_222" },
            ],
          })
        : json({}, 404);
    const r = await listManagedPages("LL_USER");
    assert.ok(r.ok);
    assert.equal(calls[0].headers.authorization, "Bearer LL_USER");
    assert.ok(!calls[0].url.includes("LL_USER"), "the user token travels in the header, not the query string");
    assert.match(new URL(calls[0].url).searchParams.get("fields") ?? "", /instagram_business_account\{id,username\}/);
    assert.deepEqual(r.value, [
      { id: "111", name: "Adelaide Property Network", accessToken: "PAGE_111", instagram: { id: "178", username: "adelaidepropertynetwork" } },
      { id: "222", name: "Side page", accessToken: "PAGE_222", instagram: null },
    ]);
  });

  it("subscribes the page to the app's webhook fields with the page token", async () => {
    handler = (c) => (c.method === "POST" && c.url.endsWith("/111/subscribed_apps") ? json({ success: true }) : json({}, 404));
    const r = await subscribePageToApp("111", "PAGE_111");
    assert.ok(r.ok);
    assert.equal(calls[0].headers.authorization, "Bearer PAGE_111");
    assert.deepEqual(JSON.parse(calls[0].body ?? "{}"), { subscribed_fields: PAGE_WEBHOOK_FIELDS.join(",") });
  });

  it("treats a subscription that Meta did not confirm as a failure", async () => {
    handler = () => json({ success: false });
    const r = await subscribePageToApp("111", "PAGE_111");
    assert.equal(r.ok, false);
  });

  it("inspects a token: never-expiring page tokens come back with no expiry, plus the granted scopes", async () => {
    handler = (c) => (c.url.includes("/debug_token") ? json({ data: { is_valid: true, type: "PAGE", expires_at: 0, scopes: ["pages_show_list", "pages_manage_posts"] } }) : json({}, 404));
    const r = await inspectToken("PAGE_111", "1142218158486204", "app-secret");
    assert.ok(r.ok);
    assert.equal(r.value.expiresAt, null);
    assert.equal(r.value.type, "PAGE");
    assert.deepEqual(r.value.scopes, ["pages_show_list", "pages_manage_posts"]);
    const u = new URL(calls[0].url);
    assert.equal(u.searchParams.get("input_token"), "PAGE_111");
    assert.equal(u.searchParams.get("access_token"), "1142218158486204|app-secret");
  });

  it("inspects a token: an expiring token carries its expiry", async () => {
    handler = () => json({ data: { is_valid: true, type: "USER", expires_at: 1_767_225_600, scopes: [] } });
    const r = await inspectToken("LL_USER", "id", "secret");
    assert.ok(r.ok);
    assert.equal(r.value.expiresAt?.toISOString(), "2026-01-01T00:00:00.000Z");
  });
});

/* ---------- Saving the connection ---------- */

describe("Meta connect: saving the page and Instagram account on a workspace", () => {
  let tenant: TenantSummary;

  before(async () => {
    tenant = await provisionTenant({ templateKey: "real_estate", name: "Metaconnect Realty", slug: "", region: "au", timezone: "Australia/Adelaide", locale: "en-AU", currency: "aud", fromName: "Metaconnect", replyTo: "office@metaconnect.example", serviceAreas: ["Adelaide"], requiredFooter: "Metaconnect Realty | RLA 000002" });
  });

  it("stores one page token on the META integration keyed by the page id, and one channel per surface", async () => {
    const result = await connectMetaChannels(tenant.id, { pageId: "111", pageName: "Adelaide Property Network", pageToken: "PAGE_111", instagram: { id: "178", username: "adelaidepropertynetwork" } });
    const integration = await repository.findIntegration(tenant.id, "META");
    assert.ok(integration);
    assert.equal(integration.status, "CONNECTED");
    assert.equal(integration.externalAccountId, "111", "webhooks resolve the tenant by the page id");
    assert.ok(integration.credentialsEnc);
    const creds = JSON.parse(decryptSecret(integration.credentialsEnc, integration.id)) as Record<string, unknown>;
    assert.equal(creds.accessToken, "PAGE_111");
    assert.equal(creds.pageId, "111");
    assert.equal(creds.igUserId, "178");

    assert.equal(result.facebook.platform, "FACEBOOK");
    assert.equal(result.facebook.externalAccountId, "111");
    assert.equal(result.facebook.displayName, "Adelaide Property Network");
    assert.equal(result.facebook.integrationId, integration.id);
    assert.ok(result.instagram);
    assert.equal(result.instagram.platform, "INSTAGRAM");
    assert.equal(result.instagram.externalAccountId, "178");
    assert.equal(result.instagram.settings.igUserId, "178");
    assert.equal(result.instagram.displayName, "@adelaidepropertynetwork");
    assert.equal(result.instagram.integrationId, integration.id);

    const owner = await repository.findTenantByIntegrationAccount("META", "111");
    assert.equal(owner?.id, tenant.id);
  });

  it("re-running replaces the token and keeps the same rows", async () => {
    await connectMetaChannels(tenant.id, { pageId: "111", pageName: "Adelaide Property Network", pageToken: "PAGE_111_ROTATED", instagram: { id: "178", username: "adelaidepropertynetwork" } });
    const integration = await repository.findIntegration(tenant.id, "META");
    assert.ok(integration?.credentialsEnc);
    assert.equal((JSON.parse(decryptSecret(integration.credentialsEnc, integration.id)) as { accessToken: string }).accessToken, "PAGE_111_ROTATED");
    const channels = (await repository.listChannels(tenant.id)).filter((c) => c.platform === "FACEBOOK" || c.platform === "INSTAGRAM");
    assert.equal(channels.length, 2);
  });

  it("a page without a linked Instagram account connects Facebook only", async () => {
    const other = await provisionTenant({ templateKey: "real_estate", name: "Metaconnect Two", slug: "", region: "au", timezone: "Australia/Adelaide", locale: "en-AU", currency: "aud", fromName: "Two", replyTo: "two@metaconnect.example", serviceAreas: ["Adelaide"], requiredFooter: "Two | RLA 000003" });
    const result = await connectMetaChannels(other.id, { pageId: "222", pageName: "Side page", pageToken: "PAGE_222", instagram: null });
    assert.equal(result.instagram, null);
    assert.equal((await repository.listChannels(other.id)).filter((c) => c.platform === "INSTAGRAM").length, 0);
  });

  it("the console's Instagram connect keeps the page id on the integration instead of the typed Instagram id", async () => {
    assert.equal(await metaIntegrationAccountId(tenant.id, "INSTAGRAM", "178"), "111", "an existing Meta connection keeps its page id");
    assert.equal(await metaIntegrationAccountId(tenant.id, "FACEBOOK", "999"), "999", "connecting a page always sets the page id");
    const empty = await provisionTenant({ templateKey: "real_estate", name: "Metaconnect Three", slug: "", region: "au", timezone: "Australia/Adelaide", locale: "en-AU", currency: "aud", fromName: "Three", replyTo: "three@metaconnect.example", serviceAreas: ["Adelaide"], requiredFooter: "Three | RLA 000004" });
    assert.equal(await metaIntegrationAccountId(empty.id, "INSTAGRAM", "178"), "178", "with nothing connected yet the typed id is all there is");
  });
});
