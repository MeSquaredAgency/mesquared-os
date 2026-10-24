import { createHmac, timingSafeEqual } from "node:crypto";
import { asNumber, requestJson, toDate, type HttpErr } from "@/lib/social/providers/http";
import { financeError, isRetryableStatus, type FinanceConnector, type FinanceCredentials, type FinanceResult, type ProviderInvoice, type ProviderTransaction } from "./types";

/**
 * Square (payments + invoices), read-only.
 *
 * Base URL: {SQUARE_API_BASE, default https://connect.squareup.com}
 * Auth:     Authorization: Bearer `creds.accessToken`; Square-Version header pins the API.
 * Scopes:   PAYMENTS_READ, INVOICES_READ, MERCHANT_PROFILE_READ (locations lookup)
 *
 * Endpoints:
 *   payments   GET  /v2/payments?begin_time=…&sort_order=ASC&limit=100[&location_id=…]   PAYMENTS_READ
 *   invoices   POST /v2/invoices/search  {query:{filter:{location_ids},sort},limit:100}   INVOICES_READ
 *   locations  GET  /v2/locations  (only when creds.locationId is not set)                 MERCHANT_PROFILE_READ
 *
 * Webhooks: signature = base64(HMAC-SHA256(signatureKey, notificationUrl + rawBody)),
 * delivered in `x-square-hmacsha256-signature`. payment.created / payment.updated
 * carry data.object.payment; invoice.* events carry data.object.invoice.
 *
 * Amounts from Square are already in minor units. A payment with
 * refunded_money > 0 also yields a REFUND row with a negative amount.
 * `order_id` is not an invoice id; invoiceExternalId stays null unless the
 * payment itself carries an invoice id.
 */

export const SQUARE_VERSION = "2025-01-23";
const MAX_PAGES = 20;
const PAGE_LIMIT = 100;

function apiBase(): string {
  return (process.env.SQUARE_API_BASE || "https://connect.squareup.com").replace(/\/+$/, "");
}

function headers(creds: FinanceCredentials): Record<string, string> {
  return { Authorization: `Bearer ${creds.accessToken}`, "Square-Version": SQUARE_VERSION };
}

function squareFailure(err: HttpErr, fallback: string): { ok: false; error: string; retryable: boolean } {
  if (err.status === 0) return { ok: false, error: err.error, retryable: true };
  const retryable = err.status === 401 || err.status === 403 ? false : isRetryableStatus(err.status);
  return { ok: false, error: financeError(err.status, err.body, fallback), retryable };
}

interface Money {
  amount?: number | string;
  currency?: string;
}

export interface SquarePayment {
  id?: string;
  status?: string;
  amount_money?: Money;
  refunded_money?: Money;
  created_at?: string;
  updated_at?: string;
  note?: string;
  receipt_number?: string;
  buyer_email_address?: string;
  order_id?: string;
  invoice_id?: string;
  customer_id?: string;
  card_details?: { card?: { cardholder_name?: string } };
}

interface PaymentsResponse {
  payments?: SquarePayment[];
  cursor?: string;
}

interface PaymentRequest {
  computed_amount_money?: Money;
  total_completed_amount_money?: Money;
  due_date?: string;
}

export interface SquareInvoice {
  id?: string;
  invoice_number?: string;
  status?: string;
  public_url?: string;
  created_at?: string;
  updated_at?: string;
  payment_requests?: PaymentRequest[];
  primary_recipient?: { given_name?: string; family_name?: string; company_name?: string; email_address?: string };
}

interface InvoicesSearchResponse {
  invoices?: SquareInvoice[];
  cursor?: string;
}

interface LocationsResponse {
  locations?: { id?: string; status?: string }[];
}

function minor(m: Money | undefined): number {
  return Math.round(asNumber(m?.amount) ?? 0);
}

function paymentStatus(status: string | undefined): ProviderTransaction["status"] {
  switch (status) {
    case "COMPLETED":
      return "COMPLETED";
    case "CANCELED":
    case "FAILED":
      return "FAILED";
    default:
      return "PENDING";
  }
}

/** One Square payment → a PAYMENT row and, when money went back, a REFUND row. */
export function mapSquarePayment(p: SquarePayment, fallbackCurrency = "USD"): ProviderTransaction[] {
  if (!p.id) return [];
  const currency = p.amount_money?.currency ?? fallbackCurrency;
  const occurredAt = toDate(p.created_at) ?? new Date();
  const customerEmail = p.buyer_email_address ?? null;
  const customerName = p.card_details?.card?.cardholder_name ?? null;
  const note = p.note || p.receipt_number || null;
  const rows: ProviderTransaction[] = [
    {
      externalId: p.id,
      kind: "PAYMENT",
      status: paymentStatus(p.status),
      amountCents: minor(p.amount_money),
      currency,
      occurredAt,
      note,
      customerName,
      customerEmail,
      invoiceExternalId: p.invoice_id ?? null,
    },
  ];
  const refunded = minor(p.refunded_money);
  if (refunded > 0) {
    rows.push({
      externalId: `${p.id}:refund`,
      kind: "REFUND",
      status: "COMPLETED",
      amountCents: -refunded,
      currency: p.refunded_money?.currency ?? currency,
      occurredAt: toDate(p.updated_at) ?? occurredAt,
      note,
      customerName,
      customerEmail,
      invoiceExternalId: p.invoice_id ?? null,
    });
  }
  return rows;
}

function invoiceStatus(status: string | undefined, dueAt: Date | null, now: Date): ProviderInvoice["status"] {
  switch (status) {
    case "DRAFT":
      return "DRAFT";
    case "PAID":
      return "PAID";
    case "CANCELED":
    case "FAILED":
    case "REFUNDED":
      return "VOID";
    case "UNPAID":
    case "SCHEDULED":
    case "PARTIALLY_PAID":
      return dueAt && dueAt.getTime() < now.getTime() ? "OVERDUE" : "SENT";
    default:
      return "SENT";
  }
}

/** Square sends YYYY-MM-DD; treat the due date as the end of that day in UTC so "today" is not overdue yet. */
function dueDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T23:59:59.999Z`) : toDate(value);
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

export function mapSquareInvoice(inv: SquareInvoice, now = new Date()): ProviderInvoice | null {
  if (!inv.id) return null;
  const requests = inv.payment_requests ?? [];
  const first = requests[0];
  const total = requests.reduce((sum, r) => sum + minor(r.computed_amount_money), 0);
  const completed = requests.reduce((sum, r) => sum + minor(r.total_completed_amount_money), 0);
  const currency = first?.computed_amount_money?.currency ?? first?.total_completed_amount_money?.currency ?? "USD";
  const dueAt = dueDate(first?.due_date);
  const status = invoiceStatus(inv.status, dueAt, now);
  const recipient = inv.primary_recipient;
  const personName = [recipient?.given_name, recipient?.family_name].filter(Boolean).join(" ").trim();
  return {
    externalId: inv.id,
    number: inv.invoice_number ?? null,
    amountCents: total,
    amountDueCents: status === "PAID" || status === "VOID" ? 0 : Math.max(0, total - completed),
    currency,
    status,
    issuedAt: toDate(inv.created_at),
    dueAt,
    paidAt: status === "PAID" ? toDate(inv.updated_at) : null,
    url: inv.public_url ?? null,
    customerName: personName || recipient?.company_name || null,
    customerEmail: recipient?.email_address ?? null,
  };
}

function headerValue(headers: Record<string, string | null>, name: string): string | null {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === want) return v;
  return null;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** base64(HMAC-SHA256(signatureKey, notificationUrl + body)). */
export function squareSignature(secret: string, url: string, rawBody: string): string {
  return createHmac("sha256", secret).update(url + rawBody).digest("base64");
}

interface SquareWebhook {
  merchant_id?: string;
  type?: string;
  data?: { type?: string; id?: string; object?: { payment?: SquarePayment; invoice?: SquareInvoice } };
}

export function createSquareConnector(): FinanceConnector {
  async function locationIds(creds: FinanceCredentials): Promise<FinanceResult<string[]>> {
    if (creds.locationId) return { ok: true, data: [creds.locationId] };
    const r = await requestJson<LocationsResponse>(`${apiBase()}/v2/locations`, { headers: headers(creds), fallback: "Square locations fetch failed" });
    if (!r.ok) return squareFailure(r, "Square locations fetch failed");
    const ids = (r.body.locations ?? []).map((l) => l.id).filter((id): id is string => Boolean(id));
    if (ids.length === 0) return { ok: false, error: "Square returned no locations for this account", retryable: false };
    return { ok: true, data: ids };
  }

  async function fetchTransactions(creds: FinanceCredentials, since: Date): Promise<FinanceResult<ProviderTransaction[]>> {
    const out: ProviderTransaction[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(`${apiBase()}/v2/payments`);
      url.searchParams.set("begin_time", since.toISOString());
      url.searchParams.set("sort_order", "ASC");
      url.searchParams.set("limit", String(PAGE_LIMIT));
      if (creds.locationId) url.searchParams.set("location_id", creds.locationId);
      if (cursor) url.searchParams.set("cursor", cursor);
      const r = await requestJson<PaymentsResponse>(url, { headers: headers(creds), fallback: "Square payments fetch failed" });
      if (!r.ok) return squareFailure(r, "Square payments fetch failed");
      for (const p of r.body.payments ?? []) out.push(...mapSquarePayment(p));
      cursor = r.body.cursor || undefined;
      if (!cursor) break;
    }
    return { ok: true, data: out };
  }

  async function fetchInvoices(creds: FinanceCredentials, since: Date): Promise<FinanceResult<ProviderInvoice[]>> {
    const locations = await locationIds(creds);
    if (!locations.ok) return locations;
    const out: ProviderInvoice[] = [];
    let cursor: string | undefined;
    const now = new Date();
    for (let page = 0; page < MAX_PAGES; page++) {
      const body: Record<string, unknown> = {
        query: { filter: { location_ids: locations.data }, sort: { field: "INVOICE_SORT_DATE", order: "DESC" } },
        limit: PAGE_LIMIT,
      };
      if (cursor) body.cursor = cursor;
      const r = await requestJson<InvoicesSearchResponse>(`${apiBase()}/v2/invoices/search`, { method: "POST", headers: headers(creds), body, fallback: "Square invoices search failed" });
      if (!r.ok) return squareFailure(r, "Square invoices search failed");
      let sawOlder = false;
      for (const inv of r.body.invoices ?? []) {
        const updated = toDate(inv.updated_at) ?? toDate(inv.created_at);
        if (updated && updated < since) {
          sawOlder = true;
          continue;
        }
        const mapped = mapSquareInvoice(inv, now);
        if (mapped) out.push(mapped);
      }
      cursor = r.body.cursor || undefined;
      // Sorted newest-first: once a page holds nothing newer than `since`, later pages will not either.
      if (!cursor || (sawOlder && (r.body.invoices ?? []).every((inv) => (toDate(inv.updated_at) ?? toDate(inv.created_at) ?? now) < since))) break;
    }
    return { ok: true, data: out };
  }

  function verifyWebhook(rawBody: string, hdrs: Record<string, string | null>, secret: string, url?: string): boolean {
    const given = headerValue(hdrs, "x-square-hmacsha256-signature");
    if (!given || !secret || !url) return false;
    return safeEqual(squareSignature(secret, url, rawBody), given);
  }

  function parseWebhook(body: unknown): { transactions: ProviderTransaction[]; invoices: ProviderInvoice[]; merchantId: string | null } {
    const b = (body ?? {}) as SquareWebhook;
    const type = b.type ?? "";
    const transactions: ProviderTransaction[] = [];
    const invoices: ProviderInvoice[] = [];
    if ((type === "payment.created" || type === "payment.updated") && b.data?.object?.payment) {
      transactions.push(...mapSquarePayment(b.data.object.payment));
    } else if (type.startsWith("invoice.") && b.data?.object?.invoice) {
      const inv = mapSquareInvoice(b.data.object.invoice);
      if (inv) invoices.push(inv);
    }
    return { transactions, invoices, merchantId: b.merchant_id ?? null };
  }

  return { name: "square", provider: "SQUARE", fetchTransactions, fetchInvoices, verifyWebhook, parseWebhook };
}

export const squareConnector: FinanceConnector = createSquareConnector();
