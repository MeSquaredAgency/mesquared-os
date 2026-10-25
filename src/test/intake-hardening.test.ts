import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { repository, TenantMismatchError } from "@/lib/data";
import { demoTenants } from "@/lib/data/fixtures";
import { _resetIntakeLimiter, takeIntakeToken } from "@/lib/intake/rate-limit";
import { intakeSchema, redactPayload } from "@/lib/intake/schema";
import { parseBudget, scoreLead } from "@/lib/qualify/rules";
import { zonedLocalToUtc } from "@/lib/utils";

const baseLead = {
  contactId: null,
  source: "WEB_FORM" as const,
  firstName: null,
  lastName: null,
  email: "scope@example.com",
  phone: null,
  company: null,
  message: null,
  attributes: {},
  attribution: {},
  ticketType: "RED" as const,
  intentScore: 10,
  qualificationReason: "test",
  qualifiedBy: "stub",
  pipelineId: null,
  stageId: null,
  valueCents: 0,
  respondBy: null,
  bookBy: null,
};

describe("intake field bounding", () => {
  it("keeps scalars only, caps key count and value length", () => {
    const fields: Record<string, unknown> = { nested: { a: 1 }, list: [1], ok: "x".repeat(600), n: 5, b: true };
    for (let i = 0; i < 40; i++) fields[`k${i}`] = "v";
    const r = intakeSchema.parse({ email: "a@b.co", fields });
    assert.equal("nested" in r.fields, false);
    assert.equal((r.fields.ok as string).length, 500);
    assert.equal(r.fields.n, 5);
    assert.ok(Object.keys(r.fields).length <= 30);
  });

  it("reports an invalid phone clearly and trims emails", () => {
    const r = intakeSchema.safeParse({ phone: "n/a" });
    assert.equal(r.success, false);
    if (!r.success) assert.ok(r.error.issues.some((i) => i.path[0] === "phone" && /invalid/i.test(i.message)));
    assert.equal(intakeSchema.parse({ email: "  A@B.co  " }).email, "a@b.co");
  });
});

describe("redactPayload", () => {
  it("masks credential-like keys and truncates long strings", () => {
    const out = redactPayload({ email: "a@b.co", password: "hunter2", card_number: "4111", nested: { cvv: "123", ok: 1 }, long: "y".repeat(3000) }) as Record<string, unknown>;
    assert.equal(out.email, "a@b.co");
    assert.equal(out.password, "[redacted]");
    assert.equal((out.nested as Record<string, unknown>).cvv, "[redacted]");
    assert.ok((out.long as string).length < 2100);
  });
});

describe("intake rate limiter", () => {
  it("allows a burst up to capacity, then refuses with a retry hint", async () => {
    _resetIntakeLimiter();
    const t0 = 1_000_000;
    let allowed = 0;
    for (let i = 0; i < 70; i++) if ((await takeIntakeToken("tenant_x", t0)).allowed) allowed++;
    assert.equal(allowed, 60);
    assert.equal((await takeIntakeToken("tenant_x", t0)).allowed, false);
    assert.equal((await takeIntakeToken("tenant_y", t0)).allowed, true);
    assert.equal((await takeIntakeToken("tenant_x", t0 + 61_000)).allowed, true);
  });
});

describe("tenant-scoped writes", () => {
  it("refuses to attach anything to another tenant's lead or contact", async () => {
    const [a, b] = demoTenants;
    const contact = await repository.upsertContact(a.id, { firstName: "Scope", lastName: null, email: "scope@example.com", phone: null, company: null });
    const { lead } = await repository.createLead(a.id, { ...baseLead, contactId: contact.id, externalId: "scope_1" });
    await assert.rejects(repository.createBooking(b.id, { leadId: lead.id, bookingUrl: "http://x", sent: false }), TenantMismatchError);
    await assert.rejects(repository.recordAutomationRun(b.id, { typeKey: "x", outcome: "SENT", summary: "x", leadId: lead.id }), TenantMismatchError);
    await assert.rejects(repository.createException(b.id, { reason: "x", contactId: contact.id }), TenantMismatchError);
    await assert.rejects(repository.upsertMissedOpportunity(b.id, { type: "NOT_BOOKED", leadId: lead.id, contactId: null, estimatedValueCents: 1, summary: "x", dedupeKey: "NOT_BOOKED:x" }), TenantMismatchError);
  });

  it("createLead returns the existing row instead of a second one for a repeated externalId", async () => {
    const t = demoTenants[0];
    const first = await repository.createLead(t.id, { ...baseLead, externalId: "race_1" });
    const second = await repository.createLead(t.id, { ...baseLead, externalId: "race_1" });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.lead.id, first.lead.id);
  });
});

describe("rule engine details", () => {
  it("matches whole words only", () => {
    const border = scoreLead({ source: "WEB_FORM", email: "a@b.co", message: "we live on the border of town", attributes: {} }, {});
    assert.equal(border.signals.some((s) => s.includes("order")), false);
    const order = scoreLead({ source: "WEB_FORM", email: "a@b.co", message: "I want to order two", attributes: {} }, {});
    assert.equal(order.signals.some((s) => s.includes("order")), true);
  });

  it("parses budgets sensibly", () => {
    assert.equal(parseBudget({ budget: "$4,000" }), 4000);
    assert.equal(parseBudget({ budget: "500-1000" }), 500);
    assert.equal(parseBudget({ budget: "5k" }), 5000);
    assert.equal(parseBudget({ budget: "not sure" }), null);
  });
});

describe("zonedLocalToUtc", () => {
  it("interprets a datetime-local string in the tenant zone", () => {
    assert.equal(zonedLocalToUtc("2026-01-15T14:05", "Australia/Sydney")?.toISOString(), "2026-01-15T03:05:00.000Z");
    assert.equal(zonedLocalToUtc("2026-07-15T09:00", "Europe/London")?.toISOString(), "2026-07-15T08:00:00.000Z");
    assert.equal(zonedLocalToUtc("garbage", "UTC"), null);
  });
});
