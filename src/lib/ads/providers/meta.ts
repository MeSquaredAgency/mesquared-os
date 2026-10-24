import type { AdAccountRecord } from "@/lib/types";
import { asNumber, requestJson, type HttpErr, type HttpResult } from "@/lib/social/providers/http";
import { adsError, isoDay, isRetryableStatus, type AdsCredentials, type AdsProvider, type AdsResult, type AdSpendRow } from "./types";

/**
 * Meta Marketing API (Facebook / Instagram ads), read-only.
 *
 * Base URL: https://graph.facebook.com/{META_GRAPH_VERSION, default v21.0}
 * Auth:     `creds.accessToken` (a user or system-user token with ads access)
 *           sent as an Authorization: Bearer header, never in the query string.
 *           Any `access_token` Meta puts into `paging.next` is stripped before
 *           the next page is requested.
 * Ids:      account.externalAccountId is the ad account id, with or without the
 *           "act_" prefix; both are accepted.
 *
 * Endpoints and the permissions they need:
 *   spend    GET /act_{id}/insights?level=campaign&time_increment=1&fields=…   ads_read
 *   account  GET /act_{id}?fields=name,currency                                 ads_read
 *
 * Errors: 401 and Graph error code 190 (invalid/expired token) are not
 * retryable; 429, 5xx and Graph rate-limit codes (4, 17, 32, 613) are.
 */

const DEFAULT_GRAPH_VERSION = "v21.0";
const MAX_PAGES = 20;
const PAGE_LIMIT = "500";

/** Action types Meta reports that count as a lead for our purposes. */
export const META_LEAD_ACTION_TYPES: ReadonlySet<string> = new Set([
  "lead",
  "onsite_conversion.lead_grouped",
  "offsite_conversion.fb_pixel_lead",
  "onsite_conversion.messaging_conversation_started_7d",
]);

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);
const AUTH_ERROR_CODES = new Set([190, 102, 10]);

function graphBase(): string {
  return `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION}`;
}

/** "act_123" and "123" both become "act_123". */
export function metaAccountPath(externalAccountId: string): string {
  const id = externalAccountId.trim();
  return id.startsWith("act_") ? id : `act_${id}`;
}

function authHeaders(creds: AdsCredentials): Record<string, string> {
  return { Authorization: `Bearer ${creds.accessToken}` };
}

interface GraphErrorBody {
  error?: { message?: string; code?: number; error_subcode?: number; type?: string };
}

/** Maps an HTTP failure to the adapter's error value, honouring Meta's own error codes. */
function metaFailure(err: HttpErr, fallback: string): { ok: false; error: string; retryable: boolean } {
  const code = (err.body as GraphErrorBody | null)?.error?.code;
  let retryable = isRetryableStatus(err.status);
  if (err.status === 401 || err.status === 403 || (typeof code === "number" && AUTH_ERROR_CODES.has(code))) retryable = false;
  else if (typeof code === "number" && RATE_LIMIT_CODES.has(code)) retryable = true;
  else if (err.status === 0) retryable = true;
  const error = err.status === 0 ? err.error : adsError(err.status, err.body, fallback);
  return { ok: false, error, retryable };
}

interface InsightAction {
  action_type?: string;
  value?: string | number;
}

interface InsightRow {
  date_start?: string;
  date_stop?: string;
  campaign_id?: string;
  campaign_name?: string;
  spend?: string | number;
  impressions?: string | number;
  clicks?: string | number;
  actions?: InsightAction[];
  account_currency?: string;
}

interface InsightsPage {
  data?: InsightRow[];
  paging?: { next?: string; cursors?: { after?: string } };
}

/** Decimal string in account currency → integer cents. */
export function metaSpendToCents(spend: unknown): number {
  const n = asNumber(spend);
  return n === null ? 0 : Math.round(n * 100);
}

/** Sum of the lead-like action counts on one insights row. */
export function metaLeadsFromActions(actions: InsightAction[] | undefined): number | null {
  if (!Array.isArray(actions)) return null;
  let total = 0;
  let seen = false;
  for (const a of actions) {
    if (!a?.action_type || !META_LEAD_ACTION_TYPES.has(a.action_type)) continue;
    seen = true;
    total += Math.round(asNumber(a.value) ?? 0);
  }
  return seen ? total : 0;
}

function mapRow(row: InsightRow, fallbackCurrency: string): AdSpendRow | null {
  const date = row.date_start;
  if (!date) return null;
  return {
    date,
    campaignId: row.campaign_id ?? null,
    campaignName: row.campaign_name ?? null,
    spendCents: metaSpendToCents(row.spend),
    impressions: asNumber(row.impressions) === null ? null : Math.round(asNumber(row.impressions)!),
    clicks: asNumber(row.clicks) === null ? null : Math.round(asNumber(row.clicks)!),
    leads: metaLeadsFromActions(row.actions),
    currency: row.account_currency ?? fallbackCurrency,
  };
}

/** Meta may echo the token into paging.next; never follow a URL that carries it. */
function sanitiseNext(next: string): string | null {
  try {
    const u = new URL(next);
    u.searchParams.delete("access_token");
    if (u.hostname !== "graph.facebook.com") return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function createMetaAdsProvider(): AdsProvider {
  async function fetchDailySpend(account: AdAccountRecord, creds: AdsCredentials, range: { from: Date; to: Date }): Promise<AdsResult<AdSpendRow[]>> {
    const url = new URL(`${graphBase()}/${metaAccountPath(account.externalAccountId)}/insights`);
    url.searchParams.set("fields", "spend,impressions,clicks,actions,campaign_id,campaign_name,account_currency");
    url.searchParams.set("level", "campaign");
    url.searchParams.set("time_increment", "1");
    url.searchParams.set("time_range", JSON.stringify({ since: isoDay(range.from), until: isoDay(range.to) }));
    url.searchParams.set("limit", PAGE_LIMIT);

    const rows: AdSpendRow[] = [];
    let next: string | null = url.toString();
    for (let page = 0; next && page < MAX_PAGES; page++) {
      const r: HttpResult<InsightsPage> = await requestJson<InsightsPage>(next, { headers: authHeaders(creds), fallback: "Meta insights fetch failed" });
      if (!r.ok) return metaFailure(r, "Meta insights fetch failed");
      for (const row of r.body.data ?? []) {
        const mapped = mapRow(row, account.currency);
        if (mapped) rows.push(mapped);
      }
      next = r.body.paging?.next ? sanitiseNext(r.body.paging.next) : null;
    }
    return { ok: true, data: rows };
  }

  async function fetchAccount(account: AdAccountRecord, creds: AdsCredentials): Promise<AdsResult<{ name: string | null; currency: string | null }>> {
    const url = new URL(`${graphBase()}/${metaAccountPath(account.externalAccountId)}`);
    url.searchParams.set("fields", "name,currency");
    const r = await requestJson<{ name?: string; currency?: string }>(url, { headers: authHeaders(creds), fallback: "Meta ad account fetch failed" });
    if (!r.ok) return metaFailure(r, "Meta ad account fetch failed");
    return { ok: true, data: { name: r.body.name ?? null, currency: r.body.currency ?? null } };
  }

  return { name: "meta-ads", platform: "META", fetchDailySpend, fetchAccount };
}

export const metaAdsProvider: AdsProvider = createMetaAdsProvider();
