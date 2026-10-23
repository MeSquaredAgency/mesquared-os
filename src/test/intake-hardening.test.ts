import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { repository, TenantMismatchError } from "@/lib/data";
import { demoTenants } from "@/lib/data/fixtures";
import { _resetIntakeLimiter, takeIntakeToken } from "@/lib/intake/rate-limit";
import { intakeSchema, redactPayload } from "@/lib/intake/schema";
import { parseBudget, scoreLead } from "@/lib/qualify/rules";
import { zonedLocalToUtc } from "@/lib/utils";

describe("intake field bounding", () => {
  it("keeps scalars only, caps key count and value length", () => {
    const fields: Record<string, unknown> = { nested: { a: 1 }, list: [1], ok: "x".repeat(600), n: 5, b: true };
    for (let i = 0; i < 40; i++) fields[`k${i}`] = "v";
    const r = intakeSchema.parse({ email: "a@b.co", fields });
    assert.equal("nested" in r.fields, false);
    assert.equal("list" in r.fields, false);
    assert.equal((r.fields.ok as string).length, 500);
    assert.equal(r.fields.n, 5);
    assert.equal(r.fields.b, true);
    assert.ok(Object.keys(r.fields).length <= 30);
  });

  it("reports an invalid phone clearly instead of 'missing contact'", () => {
    const r = intakeSchema.safeParse({ phone: "n/a" });
    assert.equal(r.success, false);
    if (!r.success) assert.ok(r.error.issues.some((i) => i.path[0] === "phone" && /invalid/i.test(i.message)));
  });

  it("trims then validates emails", () => {
    const r = intakeSchema.parse({ email: "  A@B.co  " });
    assert.equal(r.email, "a@b.co");
  });
});

describe("redactPayload", () => {
  it("masks credential-like keys and truncates long strings", () => {
    const out = redactPayload({ email: "a@b.co", password: "hunter2", card_number: "4111", nested: { cvv: "123", ok: 1 }, long: "y".repeat(3000) }) as Record<string, unknown>;
    assert.equal(out.email, "a@b.co");
    assert.equal(out.password, "[redacted]");
    assert.equal(out.card_number, "[redacted]");
    assert.equal((out.nested as Record<string, unknown>).cvv, "[redacted]");
    assert.equal((out.nested as Record<string, unknown>).ok, 1);
    assert.ok((out.long as string).length < 2100);
  });
});

describe("intake rate limiter", () => {
  it("allows a burst up to capacity, then refuses with a retry hint", () => {
    _resetIntakeLimiter();
    const t0 = 1_000_000;
    let allowed = 0;
    for (let i = 0; i < 70; i++) if (takeIntakeToken("tenant_x", t0).allowed) allowed++;
    assert.equal(allowed, 60);
    const refused = takeIntakeToken("tenant_x", t0);
    assert.equal(refused.allowed, false);
    assert.ok(refused.retryAfterSeconds >= 1);
    assert.equal(takeIntakeToken("tenant_y", t0).allowed, true, "limits are per tenant");
    assert.equal(takeIntakeToken("tenant_x", t0 + 61_000).allowed, true, "bucket refills");
  });
});

describe("tenant-scoped writes", () => {
  it("refuses to attach a task to another tenant's lead", async () => {
    const [a, b] = demoTenants;
    const { lead } = await repository.createLead(a.id, {
      source: "WEB_FORM",
      externalId: "scope_1",
      firstName: "Scope",
      lastName: null,
      email: "scope@example.com",
      phone: null,
      company: null,
      message: null,
      attributes: {},
      ticketType: "RED",
      intentScore: 10,
      qualificationReason: "test",
      qualifiedBy: "stub",
    });
    await assert.rejects(
      repository.createTask(b.id, { leadId: lead.id, type: "RED", title: "x", description: null, priority: "LOW", dueAt: null, automationKey: null }),
      TenantMismatchError,
    );
    await assert.rejects(repository.createBooking(b.id, { leadId: lead.id, bookingUrl: "http://x", sent: false }), TenantMismatchError);
  });

  it("createLead returns the existing row instead of a second one for a repeated externalId", async () => {
    const t = demoTenants[0];
    const base = {
      source: "WEB_FORM" as const,
      externalId: "race_1",
      firstName: null,
      lastName: null,
      email: "race@example.com",
      phone: null,
      company: null,
      message: null,
      attributes: {},
      ticketType: "RED" as const,
      intentScore: 10,
      qualificationReason: "test",
      qualifiedBy: "stub",
    };
    const first = await repository.createLead(t.id, base);
    const second = await repository.createLead(t.id, base);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.lead.id, first.lead.id);
  });
});

describe("rule engine details", () => {
  it("matches whole words only", () => {
    const rules = {};
    const border = scoreLead({ source: "WEB_FORM", email: "a@b.co", message: "we live on the border of town", attributes: {} }, rules);
    assert.equal(border.signals.some((s) => s.includes("order")), false);
    const order = scoreLead({ source: "WEB_FORM", email: "a@b.co", message: "I want to order two", attributes: {} }, rules);
    assert.equal(order.signals.some((s) => s.includes("order")), true);
  });

  it("parses budgets sensibly", () => {
    assert.equal(parseBudget({ budget: "$4,000" }), 4000);
    assert.equal(parseBudget({ budget: "500-1000" }), 500);
    assert.equal(parseBudget({ budget: "5k" }), 5000);
    assert.equal(parseBudget({ budget: "not sure" }), null);
    assert.equal(parseBudget({ budget: -5 }), null);
  });
});

describe("zonedLocalToUtc", () => {
  it("interprets a datetime-local string in the tenant zone", () => {
    assert.equal(zonedLocalToUtc("2026-01-15T14:05", "Australia/Sydney")?.toISOString(), "2026-01-15T03:05:00.000Z");
    assert.equal(zonedLocalToUtc("2026-01-14T22:05", "America/New_York")?.toISOString(), "2026-01-15T03:05:00.000Z");
    assert.equal(zonedLocalToUtc("2026-07-15T09:00", "Europe/London")?.toISOString(), "2026-07-15T08:00:00.000Z");
    assert.equal(zonedLocalToUtc("garbage", "UTC"), null);
  });
});
