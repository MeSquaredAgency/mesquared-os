import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { registerBuiltInFinanceConnectors } from "@/lib/finance/providers/builtin";
import { financeConnectorFor, hasRealFinanceConnector } from "@/lib/finance/providers/index";
import { createSquareConnector, mapSquareInvoice, mapSquarePayment, SQUARE_VERSION, squareSignature } from "@/lib/finance/providers/square";
import { createStripeConnector, mapStripeCharge, mapStripeInvoice, stripeSignature, verifyStripeSignature } from "@/lib/finance/providers/stripe";
import type { FinanceCredentials } from "@/lib/finance/providers/types";
import { createXeroConnector, mapXeroInvoice, parseXeroDate, refreshXeroToken, xeroAmountToCents } from "@/lib/finance/providers/xero";

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

function callsTo(pathPart: string): RecordedCall[] {
  return calls.filter((c) => c.url.includes(pathPart));
}

/* ---------- fixtures ---------- */

const TOKEN = "tok_finance_secret";
const SINCE = new Date("2026-10-01T00:00:00Z");
const creds: FinanceCredentials = { accessToken: TOKEN };

const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = ["SQUARE_API_BASE", "XERO_CLIENT_ID", "XERO_CLIENT_SECRET", "FINANCE_MODE"];

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

/* ---------- Square ---------- */

const squarePayment = {
  id: "pay_1",
  status: "COMPLETED",
  amount_money: { amount: 15000, currency: "AUD" },
  refunded_money: { amount: 0, currency: "AUD" },
  created_at: "2026-10-02T03:04:05Z",
  updated_at: "2026-10-02T03:04:06Z",
  note: "Consult deposit",
  receipt_number: "RCPT1",
  buyer_email_address: "pat@example.test",
  order_id: "order_1",
  card_details: { card: { cardholder_name: "Pat Example" } },
};

const squareInvoice = {
  id: "inv_1",
  invoice_number: "0042",
  status: "UNPAID",
  public_url: "https://squareup.com/pay-invoice/inv_1",
  created_at: "2026-10-02T00:00:00Z",
  updated_at: "2026-10-03T00:00:00Z",
  payment_requests: [{ computed_amount_money: { amount: 50000, currency: "AUD" }, total_completed_amount_money: { amount: 10000, currency: "AUD" }, due_date: "2099-10-20" }],
  primary_recipient: { given_name: "Sam", family_name: "Fictional", email_address: "sam@example.test" },
};

describe("square connector", () => {
  const square = createSquareConnector();

  it("lists payments ascending from since with the Square-Version header, pages on cursor and maps rows", async () => {
    handler = route({
      "GET connect.squareup.com/v2/payments": (call) => {
        const u = new URL(call.url);
        if (u.searchParams.get("cursor") === "c2") {
          return json({ payments: [{ id: "pay_2", status: "CANCELED", amount_money: { amount: 500, currency: "AUD" }, created_at: "2026-10-03T00:00:00Z" }] });
        }
        return json({ payments: [squarePayment, { ...squarePayment, id: "pay_r", refunded_money: { amount: 2500, currency: "AUD" }, status: "COMPLETED" }], cursor: "c2" });
      },
    });
    const r = await square.fetchTransactions({ ...creds, locationId: "L1" }, SINCE);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(calls.length, 2);
    const u = new URL(calls[0].url);
    assert.equal(u.origin + u.pathname, "https://connect.squareup.com/v2/payments");
    assert.equal(u.searchParams.get("begin_time"), "2026-10-01T00:00:00.000Z");
    assert.equal(u.searchParams.get("sort_order"), "ASC");
    assert.equal(u.searchParams.get("limit"), "100");
    assert.equal(u.searchParams.get("location_id"), "L1");
    assert.equal(calls[0].headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(calls[0].headers["square-version"], SQUARE_VERSION);
    assert.equal(new URL(calls[1].url).searchParams.get("cursor"), "c2");
    for (const c of calls) assert.ok(!c.url.includes(TOKEN));

    assert.equal(r.data.length, 4, "two payments, one refund row, one cancelled payment");
    assert.deepEqual(r.data[0], {
      externalId: "pay_1",
      kind: "PAYMENT",
      status: "COMPLETED",
      amountCents: 15000,
      currency: "AUD",
      occurredAt: new Date("2026-10-02T03:04:05Z"),
      note: "Consult deposit",
      customerName: "Pat Example",
      customerEmail: "pat@example.test",
      invoiceExternalId: null,
    });
    const refund = r.data.find((t) => t.externalId === "pay_r:refund")!;
    assert.equal(refund.kind, "REFUND");
    assert.equal(refund.amountCents, -2500);
    assert.equal(r.data.find((t) => t.externalId === "pay_2")!.status, "FAILED");
  });

  it("uses receipt_number when there is no note and keeps order_id out of invoiceExternalId", () => {
    const [t] = mapSquarePayment({ ...squarePayment, note: undefined, status: "APPROVED" });
    assert.equal(t.note, "RCPT1");
    assert.equal(t.status, "PENDING");
    assert.equal(t.invoiceExternalId, null);
    const [withInvoice] = mapSquarePayment({ ...squarePayment, invoice_id: "inv_9" });
    assert.equal(withInvoice.invoiceExternalId, "inv_9");
  });

  it("searches invoices across all locations when none is set and maps statuses", async () => {
    handler = route({
      "GET connect.squareup.com/v2/locations": () => json({ locations: [{ id: "L1" }, { id: "L2" }] }),
      "POST connect.squareup.com/v2/invoices/search": () =>
        json({
          invoices: [
            squareInvoice,
            { ...squareInvoice, id: "inv_overdue", status: "PARTIALLY_PAID", payment_requests: [{ computed_amount_money: { amount: 1000, currency: "AUD" }, total_completed_amount_money: { amount: 200, currency: "AUD" }, due_date: "2020-01-01" }] },
            { ...squareInvoice, id: "inv_paid", status: "PAID" },
            { ...squareInvoice, id: "inv_void", status: "CANCELED" },
            { ...squareInvoice, id: "inv_draft", status: "DRAFT" },
            { ...squareInvoice, id: "inv_old", updated_at: "2026-09-01T00:00:00Z" },
          ],
        }),
    });
    const r = await square.fetchInvoices!(creds, SINCE);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(calls[0].url, "https://connect.squareup.com/v2/locations");
    const search = calls[1];
    assert.equal(search.method, "POST");
    assert.equal(search.url, "https://connect.squareup.com/v2/invoices/search");
    assert.deepEqual(search.json(), { query: { filter: { location_ids: ["L1", "L2"] }, sort: { field: "INVOICE_SORT_DATE", order: "DESC" } }, limit: 100 });

    const byId = Object.fromEntries(r.data.map((i) => [i.externalId, i]));
    assert.equal("inv_old" in byId, false, "invoices not updated since `since` are skipped");
    assert.equal(byId.inv_1.status, "SENT");
    assert.equal(byId.inv_1.number, "0042");
    assert.equal(byId.inv_1.amountCents, 50000);
    assert.equal(byId.inv_1.amountDueCents, 40000);
    assert.equal(byId.inv_1.currency, "AUD");
    assert.equal(byId.inv_1.url, "https://squareup.com/pay-invoice/inv_1");
    assert.equal(byId.inv_1.dueAt?.toISOString().slice(0, 10), "2099-10-20");
    assert.equal(byId.inv_1.customerName, "Sam Fictional");
    assert.equal(byId.inv_1.customerEmail, "sam@example.test");
    assert.equal(byId.inv_overdue.status, "OVERDUE");
    assert.equal(byId.inv_overdue.amountDueCents, 800);
    assert.equal(byId.inv_paid.status, "PAID");
    assert.equal(byId.inv_paid.amountDueCents, 0);
    assert.equal(byId.inv_paid.paidAt?.toISOString(), "2026-10-03T00:00:00.000Z");
    assert.equal(byId.inv_void.status, "VOID");
    assert.equal(byId.inv_draft.status, "DRAFT");
  });

  it("honours SQUARE_API_BASE and the configured location", async () => {
    process.env.SQUARE_API_BASE = "https://connect.squareupsandbox.com/";
    handler = route({ "POST connect.squareupsandbox.com/v2/invoices/search": () => json({ invoices: [] }) });
    const r = await square.fetchInvoices!({ ...creds, locationId: "L9" }, SINCE);
    assert.equal(r.ok, true);
    assert.equal(calls.length, 1, "no locations lookup when a location is configured");
    assert.deepEqual((calls[0].json().query as { filter: unknown }).filter, { location_ids: ["L9"] });
  });

  it("returns Square's error detail with the status and the right retryable flag", async () => {
    handler = route({ "GET connect.squareup.com/v2/payments": () => json({ errors: [{ category: "AUTHENTICATION_ERROR", code: "UNAUTHORIZED", detail: "This request could not be authorized." }] }, 401) });
    const r = await square.fetchTransactions(creds, SINCE);
    assert.deepEqual(r, { ok: false, error: "This request could not be authorized. (HTTP 401)", retryable: false });
    handler = route({ "GET connect.squareup.com/v2/payments": () => json({ errors: [{ category: "RATE_LIMIT_ERROR", code: "RATE_LIMITED", detail: "slow down" }] }, 429) });
    const r2 = await square.fetchTransactions(creds, SINCE);
    assert.equal(r2.ok, false);
    if (!r2.ok) assert.equal(r2.retryable, true);
  });

  it("verifies the webhook signature over url + body and rejects tampering", () => {
    const url = "https://app.example.test/api/webhooks/square";
    const body = JSON.stringify({ merchant_id: "M1", type: "payment.updated", data: { type: "payment", id: "pay_1", object: { payment: squarePayment } } });
    const key = "sig_key_123";
    const sig = squareSignature(key, url, body);
    assert.equal(square.verifyWebhook!(body, { "x-square-hmacsha256-signature": sig }, key, url), true);
    assert.equal(square.verifyWebhook!(body, { "X-Square-HmacSha256-Signature": sig }, key, url), true, "header lookup is case-insensitive");
    assert.equal(square.verifyWebhook!(body.replace("15000", "15001"), { "x-square-hmacsha256-signature": sig }, key, url), false);
    assert.equal(square.verifyWebhook!(body, { "x-square-hmacsha256-signature": sig }, "other_key", url), false);
    assert.equal(square.verifyWebhook!(body, { "x-square-hmacsha256-signature": sig }, key, "https://elsewhere.test/hook"), false);
    assert.equal(square.verifyWebhook!(body, {}, key, url), false);
    assert.equal(square.verifyWebhook!(body, { "x-square-hmacsha256-signature": sig }, key), false, "no url means no verification");
  });

  it("parses payment and invoice webhooks", () => {
    const p = square.parseWebhook!({ merchant_id: "M1", type: "payment.created", data: { type: "payment", id: "pay_1", object: { payment: squarePayment } } });
    assert.equal(p.merchantId, "M1");
    assert.equal(p.invoices.length, 0);
    assert.equal(p.transactions.length, 1);
    assert.equal(p.transactions[0].externalId, "pay_1");
    assert.equal(p.transactions[0].amountCents, 15000);

    const i = square.parseWebhook!({ merchant_id: "M1", type: "invoice.payment_made", data: { type: "invoice", id: "inv_1", object: { invoice: { ...squareInvoice, status: "PAID" } } } });
    assert.equal(i.transactions.length, 0);
    assert.equal(i.invoices.length, 1);
    assert.equal(i.invoices[0].status, "PAID");
    assert.equal(i.invoices[0].externalId, "inv_1");

    const other = square.parseWebhook!({ merchant_id: "M1", type: "customer.created", data: {} });
    assert.deepEqual(other, { transactions: [], invoices: [], merchantId: "M1" });
    assert.equal(mapSquareInvoice({}), null);
  });
});

/* ---------- Stripe ---------- */

const stripeCharge = {
  id: "ch_1",
  object: "charge",
  amount: 12000,
  amount_refunded: 0,
  refunded: false,
  currency: "aud",
  status: "succeeded",
  created: 1759363200, // 2025-10-02T00:00:00Z
  description: "Consultation",
  receipt_email: "receipt@example.test",
  billing_details: { email: "pat@example.test", name: "Pat Example" },
  invoice: "in_1",
};

const stripeInvoice = {
  id: "in_1",
  object: "invoice",
  number: "F-0001",
  status: "open",
  amount_due: 30000,
  amount_paid: 0,
  total: 30000,
  currency: "aud",
  created: 1759363200,
  due_date: 4102444800, // 2100-01-01
  hosted_invoice_url: "https://invoice.stripe.com/i/in_1",
  customer_email: "sam@example.test",
  customer_name: "Sam Fictional",
  status_transitions: { finalized_at: 1759363300, paid_at: null },
};

describe("stripe connector", () => {
  const stripe = createStripeConnector();

  it("lists charges since the unix timestamp with a bearer key, pages with starting_after and maps rows", async () => {
    handler = route({
      "GET api.stripe.com/v1/charges": (call) => {
        const u = new URL(call.url);
        if (u.searchParams.get("starting_after") === "ch_2") return json({ object: "list", data: [{ ...stripeCharge, id: "ch_3", status: "failed" }], has_more: false });
        return json({
          object: "list",
          data: [stripeCharge, { ...stripeCharge, id: "ch_2", amount_refunded: 2000, invoice: null, billing_details: { email: null, name: null } }],
          has_more: true,
        });
      },
    });
    const r = await stripe.fetchTransactions(creds, SINCE);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(calls.length, 2);
    const u = new URL(calls[0].url);
    assert.equal(u.origin + u.pathname, "https://api.stripe.com/v1/charges");
    assert.equal(u.searchParams.get("created[gte]"), String(Math.floor(SINCE.getTime() / 1000)));
    assert.equal(u.searchParams.get("limit"), "100");
    assert.equal(calls[0].headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(new URL(calls[1].url).searchParams.get("starting_after"), "ch_2");
    for (const c of calls) assert.ok(!c.url.includes(TOKEN));

    assert.equal(r.data.length, 3);
    assert.deepEqual(r.data[0], {
      externalId: "ch_1",
      kind: "PAYMENT",
      status: "COMPLETED",
      amountCents: 12000,
      currency: "AUD",
      occurredAt: new Date(1759363200 * 1000),
      note: "Consultation",
      customerName: "Pat Example",
      customerEmail: "pat@example.test",
      invoiceExternalId: "in_1",
    });
    assert.equal(r.data[1].amountCents, 10000, "partial refund is netted off");
    assert.equal(r.data[1].kind, "PAYMENT");
    assert.equal(r.data[1].customerEmail, "receipt@example.test", "falls back to receipt_email");
    assert.equal(r.data[1].invoiceExternalId, null);
    assert.equal(r.data[2].status, "FAILED");
  });

  it("turns a fully refunded charge into a negative REFUND and maps pending", () => {
    const full = mapStripeCharge({ ...stripeCharge, amount_refunded: 12000, refunded: true })!;
    assert.equal(full.kind, "REFUND");
    assert.equal(full.amountCents, -12000);
    assert.equal(mapStripeCharge({ ...stripeCharge, status: "pending" })!.status, "PENDING");
    assert.equal(mapStripeCharge({ ...stripeCharge, invoice: { id: "in_obj" } })!.invoiceExternalId, "in_obj");
  });

  it("lists invoices and maps statuses, amounts and dates", async () => {
    handler = route({
      "GET api.stripe.com/v1/invoices": () =>
        json({
          object: "list",
          data: [
            stripeInvoice,
            { ...stripeInvoice, id: "in_overdue", due_date: 1600000000 },
            { ...stripeInvoice, id: "in_paid", status: "paid", amount_due: 0, amount_paid: 30000, status_transitions: { finalized_at: 1759363300, paid_at: 1759400000 } },
            { ...stripeInvoice, id: "in_void", status: "void" },
            { ...stripeInvoice, id: "in_unc", status: "uncollectible" },
            { ...stripeInvoice, id: "in_draft", status: "draft", due_date: null, hosted_invoice_url: null },
          ],
          has_more: false,
        }),
    });
    const r = await stripe.fetchInvoices!(creds, SINCE);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const u = new URL(calls[0].url);
    assert.equal(u.origin + u.pathname, "https://api.stripe.com/v1/invoices");
    assert.equal(u.searchParams.get("created[gte]"), String(Math.floor(SINCE.getTime() / 1000)));
    const byId = Object.fromEntries(r.data.map((i) => [i.externalId, i]));
    assert.deepEqual(byId.in_1, {
      externalId: "in_1",
      number: "F-0001",
      amountCents: 30000,
      amountDueCents: 30000,
      currency: "AUD",
      status: "SENT",
      issuedAt: new Date(1759363300 * 1000),
      dueAt: new Date(4102444800 * 1000),
      paidAt: null,
      url: "https://invoice.stripe.com/i/in_1",
      customerName: "Sam Fictional",
      customerEmail: "sam@example.test",
    });
    assert.equal(byId.in_overdue.status, "OVERDUE");
    assert.equal(byId.in_paid.status, "PAID");
    assert.equal(byId.in_paid.paidAt?.getTime(), 1759400000 * 1000);
    assert.equal(byId.in_void.status, "VOID");
    assert.equal(byId.in_unc.status, "VOID");
    assert.equal(byId.in_draft.status, "DRAFT");
    assert.equal(byId.in_draft.dueAt, null);
    assert.equal(byId.in_draft.url, null);
    assert.equal(mapStripeInvoice({}), null);
  });

  it("caps paging at 20 pages", async () => {
    handler = route({ "GET api.stripe.com/v1/charges": () => json({ object: "list", data: [{ id: "ch_x" }], has_more: true }) });
    const r = await stripe.fetchTransactions(creds, SINCE);
    assert.equal(r.ok, true);
    assert.equal(calls.length, 20);
  });

  it("maps Stripe errors with the status and retryable flag", async () => {
    handler = route({ "GET api.stripe.com/v1/charges": () => json({ error: { type: "invalid_request_error", message: "Invalid API Key provided" } }, 401) });
    const r = await stripe.fetchTransactions(creds, SINCE);
    assert.deepEqual(r, { ok: false, error: "Invalid API Key provided (HTTP 401)", retryable: false });
    handler = route({ "GET api.stripe.com/v1/charges": () => json({ error: { message: "An error occurred with our connection to Stripe." } }, 502) });
    const r2 = await stripe.fetchTransactions(creds, SINCE);
    assert.equal(r2.ok, false);
    if (!r2.ok) assert.equal(r2.retryable, true);
  });

  it("verifies Stripe-Signature within the tolerance window and rejects tampering or stale timestamps", () => {
    const body = JSON.stringify({ id: "evt_1", type: "charge.succeeded", data: { object: stripeCharge } });
    const secret = "whsec_test";
    const now = Math.floor(Date.now() / 1000);
    const t = now - 10;
    const header = `t=${t},v1=${stripeSignature(secret, t, body)}`;
    assert.equal(stripe.verifyWebhook!(body, { "stripe-signature": header }, secret), true);
    assert.equal(stripe.verifyWebhook!(body, { "Stripe-Signature": header }, secret), true);
    assert.equal(stripe.verifyWebhook!(body, { "stripe-signature": `${header},v1=deadbeef` }, secret), true, "any matching v1 is accepted");
    assert.equal(stripe.verifyWebhook!(body.replace("12000", "12001"), { "stripe-signature": header }, secret), false);
    assert.equal(stripe.verifyWebhook!(body, { "stripe-signature": header }, "whsec_other"), false);
    assert.equal(stripe.verifyWebhook!(body, { "stripe-signature": `t=${t},v0=abc` }, secret), false);
    assert.equal(stripe.verifyWebhook!(body, {}, secret), false);
    const old = now - 600;
    assert.equal(verifyStripeSignature(body, `t=${old},v1=${stripeSignature(secret, old, body)}`, secret), false, "older than 5 minutes");
    assert.equal(verifyStripeSignature(body, `t=${old},v1=${stripeSignature(secret, old, body)}`, secret, old + 100), true, "same header is fine when `now` is close to t");
  });

  it("parses charge and invoice events with the connected account as merchantId", () => {
    const c = stripe.parseWebhook!({ id: "evt_1", type: "charge.refunded", account: "acct_123", data: { object: { ...stripeCharge, amount_refunded: 12000, refunded: true } } });
    assert.equal(c.merchantId, "acct_123");
    assert.equal(c.invoices.length, 0);
    assert.equal(c.transactions.length, 1);
    assert.equal(c.transactions[0].kind, "REFUND");
    assert.equal(c.transactions[0].amountCents, -12000);

    const i = stripe.parseWebhook!({ id: "evt_2", type: "invoice.paid", data: { object: { ...stripeInvoice, status: "paid", amount_due: 0, status_transitions: { paid_at: 1759400000 } } } });
    assert.equal(i.merchantId, null);
    assert.equal(i.transactions.length, 0);
    assert.equal(i.invoices[0].status, "PAID");
    assert.equal(i.invoices[0].amountDueCents, 0);

    assert.deepEqual(stripe.parseWebhook!({ type: "customer.created", data: { object: { id: "cus_1" } } }), { transactions: [], invoices: [], merchantId: null });
  });
});

/* ---------- Xero ---------- */

const xeroInvoice = {
  InvoiceID: "x-inv-1",
  InvoiceNumber: "INV-0001",
  Type: "ACCREC",
  Status: "AUTHORISED",
  Total: 1234.56,
  AmountDue: 1234.56,
  AmountPaid: 0,
  CurrencyCode: "AUD",
  Date: "/Date(1759363200000+0000)/",
  DueDate: "/Date(4102444800000+0000)/",
  UpdatedDateUTC: "/Date(1759400000000)/",
  Contact: { ContactID: "c1", Name: "Fictional Pty Ltd", EmailAddress: "accounts@example.test" },
};

const xcreds: FinanceCredentials = { accessToken: TOKEN, xeroTenantId: "tenant-uuid" };

describe("xero connector", () => {
  const xero = createXeroConnector();

  it("parses Xero dates and amounts", () => {
    assert.equal(parseXeroDate("/Date(1700000000000+0000)/")?.toISOString(), "2023-11-14T22:13:20.000Z");
    assert.equal(parseXeroDate("/Date(1700000000000)/")?.getTime(), 1700000000000);
    assert.equal(parseXeroDate("2026-10-01T00:00:00")?.getUTCFullYear(), 2026);
    assert.equal(parseXeroDate(undefined), null);
    assert.equal(parseXeroDate("garbage"), null);
    assert.equal(xeroAmountToCents(1234.56), 123456);
    assert.equal(xeroAmountToCents("0.1"), 10);
    assert.equal(xeroAmountToCents(undefined), 0);
  });

  it("fetches ACCREC invoices with the tenant and If-Modified-Since headers, pages, and maps statuses", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ ...xeroInvoice, InvoiceID: `x-inv-${i}`, InvoiceNumber: `INV-${i}` }));
    handler = route({
      "GET api.xero.com/api.xro/2.0/Invoices": (call) => {
        const page = new URL(call.url).searchParams.get("page");
        if (page === "1") return json({ Invoices: page1 });
        return json({
          Invoices: [
            { ...xeroInvoice, InvoiceID: "x-overdue", DueDate: "/Date(1600000000000+0000)/" },
            { ...xeroInvoice, InvoiceID: "x-paid", Status: "PAID", AmountDue: 0, AmountPaid: 1234.56, FullyPaidOnDate: "/Date(1759450000000+0000)/" },
            { ...xeroInvoice, InvoiceID: "x-void", Status: "VOIDED" },
            { ...xeroInvoice, InvoiceID: "x-draft", Status: "DRAFT" },
            { ...xeroInvoice, InvoiceID: "x-past-but-paid-off", DueDate: "/Date(1600000000000+0000)/", AmountDue: 0 },
          ],
        });
      },
    });
    const r = await xero.fetchInvoices!(xcreds, SINCE);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(calls.length, 2, "second page was short, so paging stopped; no online-invoice lookups for >10 invoices");
    const u = new URL(calls[0].url);
    assert.equal(u.origin + u.pathname, "https://api.xero.com/api.xro/2.0/Invoices");
    assert.equal(u.searchParams.get("Statuses"), "AUTHORISED,PAID");
    assert.equal(u.searchParams.get("where"), 'Type=="ACCREC"');
    assert.equal(u.searchParams.get("page"), "1");
    assert.equal(calls[0].headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(calls[0].headers["xero-tenant-id"], "tenant-uuid");
    assert.equal(calls[0].headers["if-modified-since"], "2026-10-01T00:00:00");
    assert.equal(new URL(calls[1].url).searchParams.get("page"), "2");

    assert.equal(r.data.length, 105);
    const byId = Object.fromEntries(r.data.map((i) => [i.externalId, i]));
    assert.deepEqual(byId["x-inv-0"], {
      externalId: "x-inv-0",
      number: "INV-0",
      amountCents: 123456,
      amountDueCents: 123456,
      currency: "AUD",
      status: "SENT",
      issuedAt: new Date(1759363200000),
      dueAt: new Date(4102444800000),
      paidAt: null,
      url: null,
      customerName: "Fictional Pty Ltd",
      customerEmail: "accounts@example.test",
    });
    assert.equal(byId["x-overdue"].status, "OVERDUE");
    assert.equal(byId["x-paid"].status, "PAID");
    assert.equal(byId["x-paid"].amountDueCents, 0);
    assert.equal(byId["x-paid"].paidAt?.getTime(), 1759450000000);
    assert.equal(byId["x-void"].status, "VOID");
    assert.equal(byId["x-draft"].status, "DRAFT");
    assert.equal(byId["x-past-but-paid-off"].status, "SENT", "past due date with nothing owing is not overdue");
  });

  it("looks up the online invoice URL (best effort) when few invoices come back", async () => {
    handler = route({
      "GET api.xero.com/api.xro/2.0/Invoices/x-inv-1/OnlineInvoice": () => json({ OnlineInvoices: [{ OnlineInvoiceUrl: "https://in.xero.com/abc" }] }),
      "GET api.xero.com/api.xro/2.0/Invoices/x-inv-2/OnlineInvoice": () => json({ Title: "Not found" }, 404),
      "GET api.xero.com/api.xro/2.0/Invoices": () => json({ Invoices: [xeroInvoice, { ...xeroInvoice, InvoiceID: "x-inv-2" }] }),
    });
    const r = await xero.fetchInvoices!(xcreds, SINCE);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.data[0].url, "https://in.xero.com/abc");
    assert.equal(r.data[1].url, null);
    assert.equal(callsTo("/OnlineInvoice").length, 2);
    assert.equal(callsTo("/OnlineInvoice")[0].headers["if-modified-since"], undefined);
  });

  it("fetches paid bills as expenses and ACCREC payments as payments that settle their invoice", async () => {
    handler = route({
      "GET api.xero.com/api.xro/2.0/Invoices": () => json({ Invoices: [{ ...xeroInvoice, InvoiceID: "x-bill-1", InvoiceNumber: "BILL-7", Type: "ACCPAY", Status: "PAID", Total: 250.5, FullyPaidOnDate: "/Date(1759450000000+0000)/", Contact: { Name: "Fictional Supplies" } }] }),
      "GET api.xero.com/api.xro/2.0/Payments": () =>
        json({
          Payments: [
            { PaymentID: "x-pay-1", Status: "AUTHORISED", PaymentType: "ACCRECPAYMENT", Amount: 1234.56, Date: "/Date(1759450000000+0000)/", Reference: "EFT", Invoice: { InvoiceID: "x-inv-1", InvoiceNumber: "INV-0001", Type: "ACCREC", CurrencyCode: "AUD", Contact: { Name: "Fictional Pty Ltd" } } },
            { PaymentID: "x-pay-2", Status: "AUTHORISED", PaymentType: "ACCPAYPAYMENT", Amount: 250.5, Date: "/Date(1759450000000+0000)/", Invoice: { InvoiceID: "x-bill-1", Type: "ACCPAY" } },
            { PaymentID: "x-pay-3", Status: "DELETED", Amount: 5, Date: "/Date(1759450000000+0000)/", Invoice: { InvoiceID: "x-inv-1", Type: "ACCREC" } },
          ],
        }),
    });
    const r = await xero.fetchTransactions(xcreds, SINCE);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const bills = new URL(calls[0].url);
    assert.equal(bills.searchParams.get("Statuses"), "PAID");
    assert.equal(bills.searchParams.get("where"), 'Type=="ACCPAY"');
    const payments = new URL(calls[1].url);
    assert.equal(payments.origin + payments.pathname, "https://api.xero.com/api.xro/2.0/Payments");
    assert.equal(payments.searchParams.get("page"), "1");
    assert.equal(calls[1].headers["xero-tenant-id"], "tenant-uuid");

    assert.equal(r.data.length, 3, "one bill, one ACCREC payment, one deleted ACCREC payment; the ACCPAY payment is skipped");
    const bill = r.data.find((t) => t.externalId === "x-bill-1")!;
    assert.equal(bill.kind, "EXPENSE");
    assert.equal(bill.status, "COMPLETED");
    assert.equal(bill.amountCents, 25050, "expenses stay positive");
    assert.equal(bill.customerName, "Fictional Supplies");
    assert.equal(bill.note, "BILL-7");
    const pay = r.data.find((t) => t.externalId === "x-pay-1")!;
    assert.equal(pay.kind, "PAYMENT");
    assert.equal(pay.status, "COMPLETED");
    assert.equal(pay.amountCents, 123456);
    assert.equal(pay.invoiceExternalId, "x-inv-1");
    assert.equal(pay.note, "EFT");
    assert.equal(pay.customerName, "Fictional Pty Ltd");
    assert.equal(pay.occurredAt.getTime(), 1759450000000);
    assert.equal(r.data.find((t) => t.externalId === "x-pay-3")!.status, "FAILED");
  });

  it("refuses to call without a tenant id and maps Xero errors", async () => {
    const noTenant = await xero.fetchInvoices!(creds, SINCE);
    assert.equal(noTenant.ok, false);
    if (!noTenant.ok) assert.equal(noTenant.retryable, false);
    assert.equal(calls.length, 0);

    handler = route({ "GET api.xero.com/api.xro/2.0/Invoices": () => json({ Type: "Unauthorized", Title: "Unauthorized", Status: 401, Detail: "AuthenticationUnsuccessful" }, 401) });
    const r = await xero.fetchInvoices!(xcreds, SINCE);
    assert.deepEqual(r, { ok: false, error: "AuthenticationUnsuccessful (HTTP 401)", retryable: false });

    handler = route({ "GET api.xero.com/api.xro/2.0/Invoices": () => json({ Message: "Rate limit exceeded" }, 429) });
    const r2 = await xero.fetchInvoices!(xcreds, SINCE);
    assert.deepEqual(r2, { ok: false, error: "Rate limit exceeded (HTTP 429)", retryable: true });
  });

  it("refreshes an expired token with Basic client auth before calling, and keeps the rotated refresh token", async () => {
    process.env.XERO_CLIENT_ID = "xero-client";
    process.env.XERO_CLIENT_SECRET = "xero-secret";
    handler = route({
      "POST identity.xero.com/connect/token": () => json({ access_token: "tok_new", refresh_token: "rt_rotated", expires_in: 1800, token_type: "Bearer" }),
      "GET api.xero.com/api.xro/2.0/Invoices": () => json({ Invoices: [] }),
      "GET api.xero.com/api.xro/2.0/Payments": () => json({ Payments: [] }),
    });
    const expired: FinanceCredentials = { ...xcreds, accessToken: "tok_old", refreshToken: "rt_1", expiresAt: new Date(Date.now() - 1000).toISOString() };
    const r = await xero.fetchTransactions(expired, SINCE);
    assert.equal(r.ok, true);
    assert.equal(calls[0].url, "https://identity.xero.com/connect/token");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].headers.authorization, `Basic ${Buffer.from("xero-client:xero-secret").toString("base64")}`);
    assert.equal(calls[0].headers["content-type"], "application/x-www-form-urlencoded");
    assert.equal(calls[0].form().get("grant_type"), "refresh_token");
    assert.equal(calls[0].form().get("refresh_token"), "rt_1");
    assert.equal(calls[1].headers.authorization, "Bearer tok_new");
    assert.equal(calls[2].headers.authorization, "Bearer tok_new");

    const refreshed = await xero.refreshCredentials!(expired);
    assert.ok(refreshed);
    assert.equal(refreshed!.accessToken, "tok_new");
    assert.equal(refreshed!.refreshToken, "rt_rotated");
    assert.equal(refreshed!.xeroTenantId, "tenant-uuid");
    assert.ok(new Date(refreshed!.expiresAt!).getTime() > Date.now());
  });

  it("does not refresh a token that is still valid and reports a refresh that cannot happen", async () => {
    handler = route({ "GET api.xero.com/api.xro/2.0/Invoices": () => json({ Invoices: [] }) });
    const r = await xero.fetchInvoices!({ ...xcreds, refreshToken: "rt", expiresAt: new Date(Date.now() + 3_600_000).toISOString() }, SINCE);
    assert.equal(r.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers.authorization, `Bearer ${TOKEN}`);

    const noRefresh = await refreshXeroToken({ accessToken: "x" });
    assert.equal(noRefresh.ok, false);
    const noEnv = await refreshXeroToken({ accessToken: "x", refreshToken: "rt" }, {} as NodeJS.ProcessEnv);
    assert.equal(noEnv.ok, false);
    if (!noEnv.ok) assert.match(noEnv.error, /XERO_CLIENT_ID/);
    assert.equal(await xero.refreshCredentials!({ accessToken: "x" }), null);
    assert.equal(mapXeroInvoice({}), null);
  });
});

/* ---------- registry ---------- */

describe("built-in finance connectors", () => {
  it("registers Square, Stripe and Xero once and the registry hands them out", () => {
    registerBuiltInFinanceConnectors();
    registerBuiltInFinanceConnectors();
    assert.equal(hasRealFinanceConnector("SQUARE"), true);
    assert.equal(hasRealFinanceConnector("STRIPE"), true);
    assert.equal(hasRealFinanceConnector("XERO"), true);
    assert.equal(hasRealFinanceConnector("QUICKBOOKS"), false);
    assert.equal(financeConnectorFor("SQUARE").name, "square");
    assert.equal(financeConnectorFor("STRIPE").name, "stripe");
    assert.equal(financeConnectorFor("XERO").name, "xero");
    assert.equal(financeConnectorFor("QUICKBOOKS").name, "log");
    process.env.FINANCE_MODE = "log";
    assert.equal(financeConnectorFor("SQUARE").name, "log");
    assert.equal(hasRealFinanceConnector("SQUARE"), false);
  });
});
