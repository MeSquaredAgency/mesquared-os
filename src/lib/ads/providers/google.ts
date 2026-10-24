import type { AdAccountRecord } from "@/lib/types";
import { freshGoogleCredentials, refreshGoogleCredentials } from "@/lib/social/providers/google-oauth";
import { asNumber, requestJson, type HttpErr } from "@/lib/social/providers/http";
import { isoDay, isRetryableStatus, type AdsCredentials, type AdsProvider, type AdsResult, type AdSpendRow } from "./types";

/**
 * Google Ads REST API, read-only.
 *
 * Base URL: https://googleads.googleapis.com/{GOOGLE_ADS_API_VERSION, default v18}
 * Auth:     Authorization: Bearer `creds.accessToken` (OAuth user token), plus
 *             developer-token:   creds.developerToken ?? env GOOGLE_ADS_DEVELOPER_TOKEN
 *             login-customer-id: creds.loginCustomerId (the manager account) when present
 *           Expired tokens are refreshed first via oauth2.googleapis.com using
 *           GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET (see google-oauth.ts).
 * Scope:    https://www.googleapis.com/auth/adwords
 * Ids:      account.externalAccountId is the customer id, dashes optional.
 *
 * Endpoints:
 *   spend    POST /customers/{id}/googleAds:search  (GAQL over `campaign`, segmented by date)
 *   account  POST /customers/{id}/googleAds:search  (GAQL `SELECT customer.descriptive_name, customer.currency_code FROM customer`)
 *
 * Paging uses `nextPageToken`/`pageToken`. The request carries no `pageSize`:
 * the API removed `page_size` in v17 and pages are a fixed 10,000 rows, so
 * sending it would be rejected on the default version.
 *
 * Error bodies look like {error:{message, details:[{errors:[{message}]}]}};
 * the innermost message is surfaced. 401/403 are not retryable; 429/5xx are.
 */

const DEFAULT_API_VERSION = "v18";
const MAX_PAGES = 20;

function apiBase(): string {
  return `https://googleads.googleapis.com/${process.env.GOOGLE_ADS_API_VERSION || DEFAULT_API_VERSION}`;
}

/** "123-456-7890" → "1234567890". */
export function googleCustomerId(externalAccountId: string): string {
  return externalAccountId.replace(/[^0-9]/g, "");
}

function headersFor(creds: AdsCredentials): { ok: true; headers: Record<string, string> } | { ok: false; error: string; retryable: boolean } {
  const developerToken = creds.developerToken || process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  if (!developerToken) return { ok: false, error: "Google Ads developer token is not configured (GOOGLE_ADS_DEVELOPER_TOKEN)", retryable: false };
  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.accessToken}`,
    "developer-token": developerToken,
  };
  if (creds.loginCustomerId) headers["login-customer-id"] = googleCustomerId(creds.loginCustomerId);
  return { ok: true, headers };
}

interface GoogleAdsErrorBody {
  error?: {
    message?: string;
    status?: string;
    details?: { errors?: { message?: string }[] }[];
  };
}

/** The most specific message Google Ads gives, with the HTTP status appended. */
export function googleAdsErrorText(status: number, body: unknown, fallback: string): string {
  const b = body as GoogleAdsErrorBody | null;
  const inner = b?.error?.details?.flatMap((d) => d.errors ?? []).find((e) => e.message)?.message;
  const msg = inner || b?.error?.message || fallback;
  return `${msg} (HTTP ${status})`.slice(0, 300);
}

function googleFailure(err: HttpErr, fallback: string): { ok: false; error: string; retryable: boolean } {
  if (err.status === 0) return { ok: false, error: err.error, retryable: true };
  const retryable = err.status === 401 || err.status === 403 ? false : isRetryableStatus(err.status);
  return { ok: false, error: googleAdsErrorText(err.status, err.body, fallback), retryable };
}

interface SearchRow {
  campaign?: { id?: string | number; name?: string; resourceName?: string };
  metrics?: { costMicros?: string | number; impressions?: string | number; clicks?: string | number; conversions?: string | number };
  segments?: { date?: string };
  customer?: { descriptiveName?: string; currencyCode?: string };
}

interface SearchResponse {
  results?: SearchRow[];
  nextPageToken?: string;
}

/** Micros → cents, rounded. */
export function microsToCents(micros: unknown): number {
  const n = asNumber(micros);
  return n === null ? 0 : Math.round(n / 10_000);
}

function intOrNull(v: unknown): number | null {
  const n = asNumber(v);
  return n === null ? null : Math.round(n);
}

export function spendQuery(from: Date, to: Date): string {
  return `SELECT segments.date, campaign.id, campaign.name, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${isoDay(from)}' AND '${isoDay(to)}' AND campaign.status != 'REMOVED'`;
}

export const ACCOUNT_QUERY = "SELECT customer.descriptive_name, customer.currency_code FROM customer";

export function createGoogleAdsProvider(): AdsProvider {
  /** Runs a GAQL query, following page tokens; returns every row or the first failure. */
  async function search(account: AdAccountRecord, creds: AdsCredentials, query: string, fallback: string, maxPages: number): Promise<AdsResult<SearchRow[]>> {
    const fresh = await freshGoogleCredentials(creds);
    if (!fresh.ok) return { ok: false, error: fresh.error, retryable: fresh.retryable };
    const h = headersFor(fresh.creds as AdsCredentials);
    if (!h.ok) return h;
    const url = `${apiBase()}/customers/${googleCustomerId(account.externalAccountId)}/googleAds:search`;
    const rows: SearchRow[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const body: Record<string, unknown> = { query };
      if (pageToken) body.pageToken = pageToken;
      const r = await requestJson<SearchResponse>(url, { method: "POST", headers: h.headers, body, fallback });
      if (!r.ok) return googleFailure(r, fallback);
      rows.push(...(r.body.results ?? []));
      pageToken = r.body.nextPageToken || undefined;
      if (!pageToken) break;
    }
    return { ok: true, data: rows };
  }

  async function fetchDailySpend(account: AdAccountRecord, creds: AdsCredentials, range: { from: Date; to: Date }): Promise<AdsResult<AdSpendRow[]>> {
    const r = await search(account, creds, spendQuery(range.from, range.to), "Google Ads report failed", MAX_PAGES);
    if (!r.ok) return r;
    const rows: AdSpendRow[] = [];
    for (const row of r.data) {
      const date = row.segments?.date;
      if (!date) continue;
      rows.push({
        date,
        campaignId: row.campaign?.id === undefined || row.campaign.id === null ? null : String(row.campaign.id),
        campaignName: row.campaign?.name ?? null,
        spendCents: microsToCents(row.metrics?.costMicros),
        impressions: intOrNull(row.metrics?.impressions),
        clicks: intOrNull(row.metrics?.clicks),
        leads: intOrNull(row.metrics?.conversions),
        currency: account.currency,
      });
    }
    return { ok: true, data: rows };
  }

  async function fetchAccount(account: AdAccountRecord, creds: AdsCredentials): Promise<AdsResult<{ name: string | null; currency: string | null }>> {
    const r = await search(account, creds, ACCOUNT_QUERY, "Google Ads account fetch failed", 1);
    if (!r.ok) return r;
    const c = r.data[0]?.customer;
    return { ok: true, data: { name: c?.descriptiveName ?? null, currency: c?.currencyCode ?? null } };
  }

  async function refreshCredentials(creds: AdsCredentials): Promise<AdsCredentials | null> {
    const refreshed = await refreshGoogleCredentials(creds);
    return refreshed ? ({ ...creds, ...refreshed } as AdsCredentials) : null;
  }

  return { name: "google-ads", platform: "GOOGLE_ADS", fetchDailySpend, fetchAccount, refreshCredentials };
}

export const googleAdsProvider: AdsProvider = createGoogleAdsProvider();
