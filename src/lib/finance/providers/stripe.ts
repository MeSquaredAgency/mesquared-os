import { createHmac, timingSafeEqual } from "node:crypto";
import { asNumber, requestJson, toDate, type HttpErr } from "@/lib/social/providers/http";
import { financeError, isRetryableStatus, type FinanceConnector, type FinanceCredentials, type FinanceResult, type ProviderInvoice, type ProviderTransaction } from "./types";

/**
 * Stripe (charges + invoices), read-only.
 *
 * Base URL: https://api.stripe.com
 * Auth:     Authorization: Bearer `creds.accessToken` (a restricted key is enough:
 *           read access to Charges and Invoices), form-encoded query parameters.
 *
 * Endpoints:
 *   charges   GET /v1/charges?created[gte]=<unix>&limit=100[&starting_after=<id>]    charges: read
 *   invoices  GET /v1/invoices?created[gte]=<unix>&limit=100[&starting_after=<id>]   invoices: read
 *
 * Webhooks: Stripe-Signature `t=<unix>,v1=<hex>[,v1=…]`; v1 = HMAC-SHA256(endpointSecret, `${t}.${rawBody}`),
 * compared constant-time, rejected when |now - t| > 5 minutes.
 * charge.succeeded / charge.refunded / charge.failed carry a charge; invoice.* carry an invoice;
 * merchantId is the Connect `account` when present.
 *
 * Mapping: succeeded → COMPLETED with amount - amount_refunded (a fully refunded
 * charge becomes kind REFUND with a negative amount), failed → FAILED, pending → PENDING.
 */

const API_BASE = "https://api.stripe.com";
const MAX_PAGES = 20;
const PAGE_LIMIT = "100";
export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

function headers(creds: FinanceCredentials): Record<string, string> {
  return { Authorization: `Bearer ${creds.accessToken}` };
}

function stripeFailure(err: HttpErr, fallback: string): { ok: false; error: string; retryable: boolean } {
  if (err.status === 0) return { ok: false, error: err.error, retryable: true };
  const retryable = err.status === 401 || err.status === 403 ? false : isRetryableStatus(err.status);
  return { ok: false, error: financeError(err.status, err.body, fallback), retryable };
}

export interface StripeCharge {
  id?: string;
  amount?: number;
  amount_refunded?: number;
  refunded?: boolean;
  currency?: string;
  status?: string;
  created?: number;
  description?: string | null;
  receipt_email?: string | null;
  billing_details?: { email?: string | null; name?: string | null };
  invoice?: string | { id?: string } | null;
}

export interface StripeInvoice {
  id?: string;
  number?: string | null;
  status?: string | null;
  amount_due?: number;
  amount_paid?: number;
  total?: number;
  currency?: string;
  created?: number;
  due_date?: number | null;
  hosted_invoice_url?: string | null;
  customer_email?: string | null;
  customer_name?: string | null;
  status_transitions?: { paid_at?: number | null; finalized_at?: number | null };
}

interface StripeList<T> {
  data?: T[];
  has_more?: boolean;
}

function unixSeconds(d: Date): string {
  return String(Math.floor(d.getTime() / 1000));
}

function upper(currency: string | undefined): string {
  return (currency ?? "usd").toUpperCase();
}

function invoiceId(inv: StripeCharge["invoice"]): string | null {
  if (!inv) return null;
  return typeof inv === "string" ? inv : inv.id ?? null;
}

export function mapStripeCharge(c: StripeCharge): ProviderTransaction | null {
  if (!c.id) return null;
  const amount = Math.round(asNumber(c.amount) ?? 0);
  const refunded = Math.round(asNumber(c.amount_refunded) ?? 0);
  const fullyRefunded = amount > 0 && (c.refunded === true || refunded >= amount);
  let status: ProviderTransaction["status"] = "PENDING";
  if (c.status === "succeeded") status = "COMPLETED";
  else if (c.status === "failed") status = "FAILED";
  return {
    externalId: c.id,
    kind: fullyRefunded ? "REFUND" : "PAYMENT",
    status,
    amountCents: fullyRefunded ? -amount : amount - refunded,
    currency: upper(c.currency),
    occurredAt: toDate(c.created) ?? new Date(),
    note: c.description ?? null,
    customerName: c.billing_details?.name ?? null,
    customerEmail: c.billing_details?.email ?? c.receipt_email ?? null,
    invoiceExternalId: invoiceId(c.invoice),
  };
}

export function mapStripeInvoice(inv: StripeInvoice, now = new Date()): ProviderInvoice | null {
  if (!inv.id) return null;
  const dueAt = toDate(inv.due_date ?? undefined);
  let status: ProviderInvoice["status"];
  switch (inv.status) {
    case "draft":
      status = "DRAFT";
      break;
    case "paid":
      status = "PAID";
      break;
    case "void":
    case "uncollectible":
      status = "VOID";
      break;
    case "open":
    default:
      status = dueAt && dueAt.getTime() < now.getTime() ? "OVERDUE" : "SENT";
  }
  return {
    externalId: inv.id,
    number: inv.number ?? null,
    amountCents: Math.round(asNumber(inv.total) ?? asNumber(inv.amount_due) ?? 0),
    amountDueCents: status === "PAID" || status === "VOID" ? 0 : Math.round(asNumber(inv.amount_due) ?? 0),
    currency: upper(inv.currency),
    status,
    issuedAt: toDate(inv.status_transitions?.finalized_at ?? undefined) ?? toDate(inv.created),
    dueAt,
    paidAt: toDate(inv.status_transitions?.paid_at ?? undefined),
    url: inv.hosted_invoice_url ?? null,
    customerName: inv.customer_name ?? null,
    customerEmail: inv.customer_email ?? null,
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

/** hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`)), as Stripe computes v1. */
export function stripeSignature(secret: string, timestamp: number | string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

/** Pure form of the check so tests can pin `now`. */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!header || !secret) return false;
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.trim().split("=", 2);
    if (k === "t" && v && /^\d+$/.test(v)) t = Number(v);
    else if (k === "v1" && v) v1.push(v);
  }
  if (t === null || v1.length === 0) return false;
  if (Math.abs(nowSeconds - t) > STRIPE_SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = stripeSignature(secret, t, rawBody);
  return v1.some((sig) => safeEqual(expected, sig));
}

interface StripeEvent {
  type?: string;
  account?: string;
  data?: { object?: StripeCharge & StripeInvoice & { object?: string } };
}

export function createStripeConnector(): FinanceConnector {
  /** Pages a Stripe list endpoint with starting_after until has_more is false or the cap is hit. */
  async function list<T extends { id?: string }>(creds: FinanceCredentials, path: string, since: Date, fallback: string): Promise<FinanceResult<T[]>> {
    const out: T[] = [];
    let startingAfter: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(`${API_BASE}${path}`);
      url.searchParams.set("created[gte]", unixSeconds(since));
      url.searchParams.set("limit", PAGE_LIMIT);
      if (startingAfter) url.searchParams.set("starting_after", startingAfter);
      const r = await requestJson<StripeList<T>>(url, { headers: headers(creds), fallback });
      if (!r.ok) return stripeFailure(r, fallback);
      const data = r.body.data ?? [];
      out.push(...data);
      const last = data[data.length - 1]?.id;
      if (!r.body.has_more || !last) break;
      startingAfter = last;
    }
    return { ok: true, data: out };
  }

  async function fetchTransactions(creds: FinanceCredentials, since: Date): Promise<FinanceResult<ProviderTransaction[]>> {
    const r = await list<StripeCharge>(creds, "/v1/charges", since, "Stripe charges fetch failed");
    if (!r.ok) return r;
    return { ok: true, data: r.data.map(mapStripeCharge).filter((t): t is ProviderTransaction => t !== null) };
  }

  async function fetchInvoices(creds: FinanceCredentials, since: Date): Promise<FinanceResult<ProviderInvoice[]>> {
    const r = await list<StripeInvoice>(creds, "/v1/invoices", since, "Stripe invoices fetch failed");
    if (!r.ok) return r;
    const now = new Date();
    return { ok: true, data: r.data.map((inv) => mapStripeInvoice(inv, now)).filter((i): i is ProviderInvoice => i !== null) };
  }

  function verifyWebhook(rawBody: string, hdrs: Record<string, string | null>, secret: string): boolean {
    return verifyStripeSignature(rawBody, headerValue(hdrs, "stripe-signature"), secret);
  }

  function parseWebhook(body: unknown): { transactions: ProviderTransaction[]; invoices: ProviderInvoice[]; merchantId: string | null } {
    const ev = (body ?? {}) as StripeEvent;
    const type = ev.type ?? "";
    const obj = ev.data?.object;
    const transactions: ProviderTransaction[] = [];
    const invoices: ProviderInvoice[] = [];
    if (obj && (type === "charge.succeeded" || type === "charge.refunded" || type === "charge.failed")) {
      const t = mapStripeCharge(obj);
      if (t) transactions.push(t);
    } else if (obj && type.startsWith("invoice.")) {
      const inv = mapStripeInvoice(obj);
      if (inv) invoices.push(inv);
    }
    return { transactions, invoices, merchantId: ev.account ?? null };
  }

  return { name: "stripe", provider: "STRIPE", fetchTransactions, fetchInvoices, verifyWebhook, parseWebhook };
}

export const stripeConnector: FinanceConnector = createStripeConnector();
