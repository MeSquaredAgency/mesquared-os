import type { AdAccountRecord, AdPlatform } from "@/lib/types";

/**
 * Ad platform adapters. Read-only: they pull daily spend and results per
 * campaign so the platform can tie spend to leads and revenue. Credentials are
 * decrypted per call and never logged; failures come back as values.
 */
export interface AdsCredentials {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  /** Google Ads only: the developer token and (optionally) the manager account id. */
  developerToken?: string | null;
  loginCustomerId?: string | null;
  [key: string]: unknown;
}

export interface AdSpendRow {
  /** YYYY-MM-DD in the account's reporting timezone. */
  date: string;
  campaignId: string | null;
  campaignName: string | null;
  spendCents: number;
  impressions: number | null;
  clicks: number | null;
  /** Leads/conversions the platform reports for the day. */
  leads: number | null;
  currency: string;
}

export type AdsResult<T> = { ok: true; data: T } | { ok: false; error: string; retryable: boolean };

export interface AdsProvider {
  readonly name: string;
  readonly platform: AdPlatform;
  /** Daily spend per campaign for the inclusive date range (at most 90 days). */
  fetchDailySpend(account: AdAccountRecord, creds: AdsCredentials, range: { from: Date; to: Date }): Promise<AdsResult<AdSpendRow[]>>;
  /** Account display name and currency, used when connecting. */
  fetchAccount?(account: AdAccountRecord, creds: AdsCredentials): Promise<AdsResult<{ name: string | null; currency: string | null }>>;
  refreshCredentials?(creds: AdsCredentials): Promise<AdsCredentials | null>;
}

export function adsError(status: number, body: unknown, fallback: string): string {
  const b = body as { error?: { message?: string } | string; message?: string } | null;
  const msg = (typeof b?.error === "object" && b.error?.message) || (typeof b?.error === "string" ? b.error : null) || b?.message || fallback;
  return `${msg} (HTTP ${status})`.slice(0, 300);
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** YYYY-MM-DD for a Date, in UTC. */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
