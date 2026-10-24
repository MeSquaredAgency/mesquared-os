import { tokenExpired } from "@/lib/social/providers/google-oauth";
import { asNumber, requestJson, type HttpErr } from "@/lib/social/providers/http";
import { isRetryableStatus, type FinanceConnector, type FinanceCredentials, type FinanceResult, type ProviderInvoice, type ProviderTransaction } from "./types";

/**
 * Xero Accounting API, read-only.
 *
 * Base URL: https://api.xero.com/api.xro/2.0
 * Auth:     Authorization: Bearer `creds.accessToken`, xero-tenant-id: `creds.xeroTenantId`,
 *           If-Modified-Since: `since` (Xero's documented `YYYY-MM-DDTHH:mm:ss` form).
 *           Expired tokens are refreshed first via
 *           POST https://identity.xero.com/connect/token (grant_type=refresh_token,
 *           Basic auth with XERO_CLIENT_ID / XERO_CLIENT_SECRET). Xero rotates the
 *           refresh token on every refresh; the new one is returned in the credentials.
 * Scopes:   accounting.invoices.read, accounting.transactions.read, offline_access
 *           (accounting.contacts.read lets Contact names/emails come through fully)
 *
 * Endpoints:
 *   invoices       GET /Invoices?Statuses=AUTHORISED,PAID&where=Type=="ACCREC"&page=N   (≤10 pages)
 *   online url     GET /Invoices/{id}/OnlineInvoice   (best effort, only when ≤10 invoices came back)
 *   bills          GET /Invoices?Statuses=PAID&where=Type=="ACCPAY"&page=N  → kind EXPENSE, amounts positive
 *   payments       GET /Payments?page=N  → ACCREC payments as kind PAYMENT, invoiceExternalId = Invoice.InvoiceID
 *
 * Dates arrive as `/Date(1700000000000+0000)/`; amounts are decimals → cents.
 * No webhooks.
 */

const API_BASE = "https://api.xero.com/api.xro/2.0";
export const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const MAX_PAGES = 10;
const PAGE_SIZE = 100;
const ONLINE_URL_LOOKUP_LIMIT = 10;

/** `/Date(1700000000000+0000)/` → Date; plain ISO strings are accepted too. */
export function parseXeroDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  // The epoch millis are absolute; the trailing offset (Xero sends +0000) only describes the wall clock.
  const m = /\/Date\((-?\d+)(?:[+-]\d{4})?\)\//.exec(value);
  if (m) {
    const ms = Number(m[1]);
    return Number.isFinite(ms) ? new Date(ms) : null;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Decimal → integer cents. */
export function xeroAmountToCents(value: unknown): number {
  const n = asNumber(value);
  return n === null ? 0 : Math.round(n * 100);
}

function xeroErrorText(status: number, body: unknown, fallback: string): string {
  const b = body as { Message?: string; message?: string; Detail?: string; Title?: string; error?: string; error_description?: string; Elements?: { ValidationErrors?: { Message?: string }[] }[] } | null;
  const validation = b?.Elements?.[0]?.ValidationErrors?.[0]?.Message;
  const msg = validation || b?.Detail || b?.Message || b?.message || b?.error_description || b?.Title || b?.error || fallback;
  return `${msg} (HTTP ${status})`.slice(0, 300);
}

function xeroFailure(err: HttpErr, fallback: string): { ok: false; error: string; retryable: boolean } {
  if (err.status === 0) return { ok: false, error: err.error, retryable: true };
  const retryable = err.status === 401 || err.status === 403 ? false : isRetryableStatus(err.status);
  return { ok: false, error: xeroErrorText(err.status, err.body, fallback), retryable };
}

function headers(creds: FinanceCredentials, since?: Date): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${creds.accessToken}` };
  if (creds.xeroTenantId) h["xero-tenant-id"] = creds.xeroTenantId;
  if (since) h["If-Modified-Since"] = since.toISOString().slice(0, 19);
  return h;
}

interface XeroContact {
  ContactID?: string;
  Name?: string;
  EmailAddress?: string;
}

export interface XeroInvoice {
  InvoiceID?: string;
  InvoiceNumber?: string;
  Type?: string;
  Status?: string;
  Total?: number | string;
  AmountDue?: number | string;
  AmountPaid?: number | string;
  CurrencyCode?: string;
  Date?: string;
  DueDate?: string;
  FullyPaidOnDate?: string;
  UpdatedDateUTC?: string;
  Reference?: string;
  Contact?: XeroContact;
}

export interface XeroPayment {
  PaymentID?: string;
  Status?: string;
  PaymentType?: string;
  Amount?: number | string;
  CurrencyRate?: number;
  Date?: string;
  UpdatedDateUTC?: string;
  Reference?: string;
  Invoice?: { InvoiceID?: string; InvoiceNumber?: string; Type?: string; CurrencyCode?: string; Contact?: XeroContact };
}

interface InvoicesResponse {
  Invoices?: XeroInvoice[];
}

interface PaymentsResponse {
  Payments?: XeroPayment[];
}

interface OnlineInvoiceResponse {
  OnlineInvoices?: { OnlineInvoiceUrl?: string }[];
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

export function mapXeroInvoice(inv: XeroInvoice, now = new Date(), fallbackCurrency = "AUD"): ProviderInvoice | null {
  if (!inv.InvoiceID) return null;
  const dueAt = parseXeroDate(inv.DueDate);
  const amountDue = xeroAmountToCents(inv.AmountDue);
  let status: ProviderInvoice["status"];
  switch (inv.Status) {
    case "PAID":
      status = "PAID";
      break;
    case "VOIDED":
    case "DELETED":
      status = "VOID";
      break;
    case "DRAFT":
    case "SUBMITTED":
      status = "DRAFT";
      break;
    case "AUTHORISED":
    default:
      status = dueAt && dueAt.getTime() < now.getTime() && amountDue > 0 ? "OVERDUE" : "SENT";
  }
  return {
    externalId: inv.InvoiceID,
    number: inv.InvoiceNumber ?? null,
    amountCents: xeroAmountToCents(inv.Total),
    amountDueCents: status === "PAID" || status === "VOID" ? 0 : amountDue,
    currency: inv.CurrencyCode ?? fallbackCurrency,
    status,
    issuedAt: parseXeroDate(inv.Date),
    dueAt,
    paidAt: status === "PAID" ? parseXeroDate(inv.FullyPaidOnDate) ?? parseXeroDate(inv.UpdatedDateUTC) : null,
    url: null,
    customerName: inv.Contact?.Name ?? null,
    customerEmail: inv.Contact?.EmailAddress ?? null,
  };
}

/** A paid supplier bill → an EXPENSE row (positive amount). */
export function mapXeroBill(inv: XeroInvoice, fallbackCurrency = "AUD"): ProviderTransaction | null {
  if (!inv.InvoiceID) return null;
  return {
    externalId: inv.InvoiceID,
    kind: "EXPENSE",
    status: inv.Status === "PAID" ? "COMPLETED" : inv.Status === "VOIDED" || inv.Status === "DELETED" ? "FAILED" : "PENDING",
    amountCents: xeroAmountToCents(inv.Total),
    currency: inv.CurrencyCode ?? fallbackCurrency,
    occurredAt: parseXeroDate(inv.FullyPaidOnDate) ?? parseXeroDate(inv.Date) ?? new Date(),
    note: inv.Reference || inv.InvoiceNumber || null,
    customerName: inv.Contact?.Name ?? null,
    customerEmail: inv.Contact?.EmailAddress ?? null,
    invoiceExternalId: null,
  };
}

/** A payment against a sales invoice → a PAYMENT row that settles that invoice. */
export function mapXeroPayment(p: XeroPayment, fallbackCurrency = "AUD"): ProviderTransaction | null {
  if (!p.PaymentID) return null;
  return {
    externalId: p.PaymentID,
    kind: "PAYMENT",
    status: p.Status === "DELETED" ? "FAILED" : "COMPLETED",
    amountCents: xeroAmountToCents(p.Amount),
    currency: p.Invoice?.CurrencyCode ?? fallbackCurrency,
    occurredAt: parseXeroDate(p.Date) ?? parseXeroDate(p.UpdatedDateUTC) ?? new Date(),
    note: p.Reference || p.Invoice?.InvoiceNumber || null,
    customerName: p.Invoice?.Contact?.Name ?? null,
    customerEmail: p.Invoice?.Contact?.EmailAddress ?? null,
    invoiceExternalId: p.Invoice?.InvoiceID ?? null,
  };
}

type RefreshOutcome = { ok: true; creds: FinanceCredentials } | { ok: false; error: string; retryable: boolean };

/** Exchanges the refresh token for a new access token (and a rotated refresh token). Never throws. */
export async function refreshXeroToken(creds: FinanceCredentials, env: NodeJS.ProcessEnv = process.env): Promise<RefreshOutcome> {
  const clientId = env.XERO_CLIENT_ID;
  const clientSecret = env.XERO_CLIENT_SECRET;
  if (!creds.refreshToken) return { ok: false, error: "Xero token expired and no refresh token is stored; reconnect Xero", retryable: false };
  if (!clientId || !clientSecret) return { ok: false, error: "XERO_CLIENT_ID / XERO_CLIENT_SECRET are not configured", retryable: false };
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const r = await requestJson<TokenResponse>(XERO_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: creds.refreshToken }),
    fallback: "Xero token refresh failed",
  });
  if (!r.ok) return { ok: false, error: `Xero token refresh failed: ${xeroErrorText(r.status, r.body, "refresh rejected")}`, retryable: r.status === 0 || isRetryableStatus(r.status) };
  if (!r.body.access_token) return { ok: false, error: "Xero token refresh returned no access token", retryable: false };
  const expiresIn = typeof r.body.expires_in === "number" ? r.body.expires_in : 1800;
  return {
    ok: true,
    creds: {
      ...creds,
      accessToken: r.body.access_token,
      refreshToken: r.body.refresh_token ?? creds.refreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    },
  };
}

export function createXeroConnector(): FinanceConnector {
  async function fresh(creds: FinanceCredentials): Promise<RefreshOutcome> {
    if (!creds.xeroTenantId) return { ok: false, error: "Xero connection has no tenant id; reconnect Xero", retryable: false };
    if (!tokenExpired(creds)) return { ok: true, creds };
    return refreshXeroToken(creds);
  }

  /** Pages through /Invoices with the given filters; stops at the first short page or the cap. */
  async function listInvoices(creds: FinanceCredentials, since: Date, statuses: string, type: string, fallback: string): Promise<FinanceResult<XeroInvoice[]>> {
    const out: XeroInvoice[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = new URL(`${API_BASE}/Invoices`);
      url.searchParams.set("Statuses", statuses);
      url.searchParams.set("where", `Type=="${type}"`);
      url.searchParams.set("page", String(page));
      const r = await requestJson<InvoicesResponse>(url, { headers: headers(creds, since), fallback });
      if (!r.ok) return xeroFailure(r, fallback);
      const rows = r.body.Invoices ?? [];
      out.push(...rows);
      if (rows.length < PAGE_SIZE) break;
    }
    return { ok: true, data: out };
  }

  async function listPayments(creds: FinanceCredentials, since: Date): Promise<FinanceResult<XeroPayment[]>> {
    const out: XeroPayment[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = new URL(`${API_BASE}/Payments`);
      url.searchParams.set("page", String(page));
      const r = await requestJson<PaymentsResponse>(url, { headers: headers(creds, since), fallback: "Xero payments fetch failed" });
      if (!r.ok) return xeroFailure(r, "Xero payments fetch failed");
      const rows = r.body.Payments ?? [];
      out.push(...rows);
      if (rows.length < PAGE_SIZE) break;
    }
    return { ok: true, data: out };
  }

  async function fetchInvoices(creds: FinanceCredentials, since: Date): Promise<FinanceResult<ProviderInvoice[]>> {
    const f = await fresh(creds);
    if (!f.ok) return f;
    const r = await listInvoices(f.creds, since, "AUTHORISED,PAID", "ACCREC", "Xero invoices fetch failed");
    if (!r.ok) return r;
    const now = new Date();
    const invoices = r.data.map((inv) => mapXeroInvoice(inv, now)).filter((i): i is ProviderInvoice => i !== null);
    if (invoices.length > 0 && invoices.length <= ONLINE_URL_LOOKUP_LIMIT) {
      await Promise.all(
        invoices.map(async (inv) => {
          const o = await requestJson<OnlineInvoiceResponse>(`${API_BASE}/Invoices/${encodeURIComponent(inv.externalId)}/OnlineInvoice`, { headers: headers(f.creds), fallback: "Xero online invoice lookup failed" });
          if (o.ok) inv.url = o.body.OnlineInvoices?.[0]?.OnlineInvoiceUrl ?? null;
        }),
      );
    }
    return { ok: true, data: invoices };
  }

  async function fetchTransactions(creds: FinanceCredentials, since: Date): Promise<FinanceResult<ProviderTransaction[]>> {
    const f = await fresh(creds);
    if (!f.ok) return f;
    const bills = await listInvoices(f.creds, since, "PAID", "ACCPAY", "Xero bills fetch failed");
    if (!bills.ok) return bills;
    const payments = await listPayments(f.creds, since);
    if (!payments.ok) return payments;
    const out: ProviderTransaction[] = [];
    for (const b of bills.data) {
      const t = mapXeroBill(b);
      if (t) out.push(t);
    }
    for (const p of payments.data) {
      if (p.Invoice?.Type && p.Invoice.Type !== "ACCREC") continue;
      const t = mapXeroPayment(p);
      if (t) out.push(t);
    }
    return { ok: true, data: out };
  }

  async function refreshCredentials(creds: FinanceCredentials): Promise<FinanceCredentials | null> {
    if (!creds.refreshToken) return null;
    const r = await refreshXeroToken(creds);
    if (!r.ok) {
      console.warn(`[finance:xero] token refresh failed: ${r.error}`);
      return null;
    }
    return r.creds;
  }

  return { name: "xero", provider: "XERO", fetchTransactions, fetchInvoices, refreshCredentials };
}

export const xeroConnector: FinanceConnector = createXeroConnector();
