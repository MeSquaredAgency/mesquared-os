import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { intakeSchema, splitName } from "@/lib/intake/schema";

describe("intake schema", () => {
  it("accepts a minimal lead with an email and applies defaults", () => {
    const r = intakeSchema.safeParse({ email: "A@Example.com" });
    assert.ok(r.success);
    assert.equal(r.data.email, "a@example.com");
    assert.equal(r.data.source, "WEB_FORM");
    assert.deepEqual(r.data.fields, {});
    assert.equal(r.data.dryRun, false);
  });

  it("accepts a phone-only lead", () => {
    assert.ok(intakeSchema.safeParse({ phone: "+61 400 000 000" }).success);
  });

  it("rejects a lead with no contact details", () => {
    const r = intakeSchema.safeParse({ message: "hello" });
    assert.equal(r.success, false);
  });

  it("rejects an invalid email and an unknown source", () => {
    assert.equal(intakeSchema.safeParse({ email: "nope" }).success, false);
    assert.equal(intakeSchema.safeParse({ email: "a@b.co", source: "CARRIER_PIGEON" }).success, false);
  });

  it("turns blank strings into null", () => {
    const r = intakeSchema.safeParse({ email: "a@b.co", company: "   ", message: "" });
    assert.ok(r.success);
    assert.equal(r.data.company, null);
    assert.equal(r.data.message, null);
  });

  it("splits a single name field when first/last are absent", () => {
    const body = intakeSchema.parse({ email: "a@b.co", name: "Margaret Anne Ellis" });
    assert.deepEqual(splitName(body), { firstName: "Margaret", lastName: "Anne Ellis" });
    const explicit = intakeSchema.parse({ email: "a@b.co", firstName: "Peter", name: "ignored" });
    assert.deepEqual(splitName(explicit), { firstName: "Peter", lastName: null });
  });
});

describe("normalizePhone", () => {
  it("keeps a leading + and strips formatting", async () => {
    const { normalizePhone } = await import("@/lib/intake/schema");
    assert.equal(normalizePhone("+61 (0)400 111-222"), "+61400111222");
    assert.equal(normalizePhone("0400 111 222"), "0400111222");
  });
  it("rejects placeholders and absurd lengths", async () => {
    const { normalizePhone } = await import("@/lib/intake/schema");
    assert.equal(normalizePhone("n/a"), null);
    assert.equal(normalizePhone("0"), null);
    assert.equal(normalizePhone("1234567890123456789"), null);
    assert.equal(normalizePhone(null), null);
  });
});
