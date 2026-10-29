import { repository } from "@/lib/data";
import type { ChannelRecord, SocialPlatform } from "@/lib/types";
import { saveChannelCredentials } from "./credentials";
import { asNumber, requestJson } from "./providers/http";

/**
 * Connecting a Facebook page and its Instagram account through the Meta app.
 *
 * One page access token serves both surfaces: Instagram Graph calls for a
 * business account go through the page it is linked to. The token lives once,
 * encrypted on the tenant's META integration row, whose `externalAccountId`
 * must be the Facebook page id because that is how a webhook (lead form,
 * comment, message) finds the tenant. The Instagram channel keeps the IG
 * business account id as its own `externalAccountId` and in `settings.igUserId`.
 *
 * The token to store is a page token derived from a long-lived user token;
 * those do not expire. A page token taken straight from Graph API Explorer's
 * short-lived user token expires with it, within about an hour.
 *
 * Nothing in this module logs; results carry the HTTP status and Meta's
 * message only, never a token or a URL that holds one.
 */

const DEFAULT_GRAPH_VERSION = "v21.0";

function graphBase(): string {
  return `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION}`;
}

/** Page webhook fields the app subscribes to, matching the Webhooks product in the app dashboard. */
export const PAGE_WEBHOOK_FIELDS = ["leadgen", "feed", "messages"] as const;

export type MetaResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface MetaPage {
  id: string;
  name: string;
  accessToken: string;
  instagram: { id: string; username: string | null } | null;
}

/**
 * Exchanges a short-lived user token (Graph API Explorer, or the Facebook
 * Login dialog) for a long-lived one, about 60 days. Meta's endpoint takes the
 * app secret and the token as query parameters; the URL is never logged.
 */
export async function exchangeForLongLivedUserToken(shortLivedToken: string, appId: string, appSecret: string): Promise<MetaResult<{ accessToken: string; expiresInSeconds: number | null }>> {
  const url = new URL(`${graphBase()}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("fb_exchange_token", shortLivedToken);
  const r = await requestJson<{ access_token?: string; expires_in?: number }>(url, { fallback: "Token exchange failed" });
  if (!r.ok) return { ok: false, error: r.error };
  if (!r.body.access_token) return { ok: false, error: "Meta returned no access token" };
  return { ok: true, value: { accessToken: r.body.access_token, expiresInSeconds: asNumber(r.body.expires_in) } };
}

/** The pages the user administers, each with its page token and linked Instagram business account. Needs `pages_show_list` (and `instagram_basic` for the link). */
export async function listManagedPages(userToken: string): Promise<MetaResult<MetaPage[]>> {
  const url = new URL(`${graphBase()}/me/accounts`);
  url.searchParams.set("fields", "id,name,access_token,instagram_business_account{id,username}");
  url.searchParams.set("limit", "100");
  const r = await requestJson<{ data?: { id?: string; name?: string; access_token?: string; instagram_business_account?: { id?: string; username?: string } }[] }>(url, {
    headers: { Authorization: `Bearer ${userToken}` },
    fallback: "Listing pages failed",
  });
  if (!r.ok) return { ok: false, error: r.error };
  const pages: MetaPage[] = [];
  for (const p of r.body.data ?? []) {
    if (!p.id || !p.access_token) continue;
    const ig = p.instagram_business_account;
    pages.push({ id: String(p.id), name: p.name ?? String(p.id), accessToken: p.access_token, instagram: ig?.id ? { id: String(ig.id), username: ig.username ?? null } : null });
  }
  return { ok: true, value: pages };
}

/**
 * Installs the app on the page for webhook delivery. The app-level Webhooks
 * subscription in the dashboard is not enough: Meta only delivers a page's
 * leadgen, feed and messages events for pages that have subscribed the app.
 * Needs `pages_manage_metadata`.
 */
export async function subscribePageToApp(pageId: string, pageToken: string, fields: readonly string[] = PAGE_WEBHOOK_FIELDS): Promise<MetaResult<true>> {
  const r = await requestJson<{ success?: boolean }>(`${graphBase()}/${pageId}/subscribed_apps`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pageToken}` },
    body: { subscribed_fields: fields.join(",") },
    fallback: "Subscribing the page to the app failed",
  });
  if (!r.ok) return { ok: false, error: r.error };
  if (r.body.success !== true) return { ok: false, error: "Meta did not confirm the page subscription" };
  return { ok: true, value: true };
}

export interface TokenInfo {
  type: string | null;
  /** Null when the token never expires (page tokens derived from a long-lived user token). */
  expiresAt: Date | null;
  scopes: string[];
  isValid: boolean;
}

/** What Meta knows about a token: type, expiry and granted permissions. Uses the app token `<appId>|<appSecret>`. */
export async function inspectToken(token: string, appId: string, appSecret: string): Promise<MetaResult<TokenInfo>> {
  const url = new URL(`${graphBase()}/debug_token`);
  url.searchParams.set("input_token", token);
  url.searchParams.set("access_token", `${appId}|${appSecret}`);
  const r = await requestJson<{ data?: { type?: string; expires_at?: number; scopes?: string[]; is_valid?: boolean } }>(url, { fallback: "Token inspection failed" });
  if (!r.ok) return { ok: false, error: r.error };
  const d = r.body.data ?? {};
  const expires = asNumber(d.expires_at);
  return {
    ok: true,
    value: {
      type: d.type ?? null,
      expiresAt: expires && expires > 0 ? new Date(expires * 1000) : null,
      scopes: Array.isArray(d.scopes) ? d.scopes.filter((s): s is string => typeof s === "string") : [],
      isValid: d.is_valid !== false,
    },
  };
}

export interface MetaConnection {
  pageId: string;
  pageName?: string | null;
  /** A page access token; store the one derived from a long-lived user token. */
  pageToken: string;
  instagram?: { id: string; username?: string | null } | null;
}

/**
 * Saves the page token once on the META integration (keyed by the page id)
 * and creates or updates the Facebook channel and, when the page has one, the
 * Instagram channel. Re-running replaces the token and keeps the rows.
 */
export async function connectMetaChannels(tenantId: string, c: MetaConnection): Promise<{ facebook: ChannelRecord; instagram: ChannelRecord | null }> {
  const igUserId = c.instagram?.id ?? null;
  await saveChannelCredentials(tenantId, "FACEBOOK", { accessToken: c.pageToken, pageId: c.pageId, ...(igUserId ? { igUserId } : {}) }, { externalAccountId: c.pageId, label: c.pageName ?? null });
  const integration = await repository.findIntegration(tenantId, "META");
  const facebook = await repository.upsertChannel(tenantId, { platform: "FACEBOOK", externalAccountId: c.pageId, displayName: c.pageName ?? null, integrationId: integration?.id ?? null, isActive: true, settings: {} });
  let instagram: ChannelRecord | null = null;
  if (igUserId) {
    const handle = c.instagram?.username ? `@${c.instagram.username.replace(/^@/, "")}` : null;
    instagram = await repository.upsertChannel(tenantId, { platform: "INSTAGRAM", externalAccountId: igUserId, displayName: handle, integrationId: integration?.id ?? null, isActive: true, settings: { igUserId } });
  }
  await repository.recordAutomationRun(tenantId, {
    typeKey: "social_sync",
    outcome: "COMPLETED",
    summary: `Connected ${c.pageName || c.pageId} on facebook${instagram ? ` and ${instagram.displayName ?? igUserId} on instagram` : ""}.`,
  });
  return { facebook, instagram };
}

/**
 * The account id to put on the META integration row when the console connects
 * one surface at a time. A page connect always sets the page id. An Instagram
 * connect must not replace it with the Instagram id, or page webhooks stop
 * finding the tenant; with nothing connected yet the typed id is all there is.
 */
export async function metaIntegrationAccountId(tenantId: string, platform: SocialPlatform, typedAccountId: string): Promise<string> {
  if (platform !== "INSTAGRAM") return typedAccountId;
  const existing = await repository.findIntegration(tenantId, "META");
  return existing?.externalAccountId || typedAccountId;
}
