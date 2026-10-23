import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GREEN_THRESHOLD, scoreLead } from "../lib/qualify/rules.ts";

const rules = {
  greenKeywords: ["implant"],
  redKeywords: ["supplier"],
  minBudget: 500,
  highIntentServices: ["dental implants"],
};

describe("rule-based qualifier", () => {
  it("classifies a ready-to-book lead with budget and phone as GREEN", () => {
    const r = scoreLead(
      {
        source: "META_LEAD_FORM",
        email: "m@example.com",
        phone: "+61 400 000 000",
        message: "Interested in dental implants, would like a consult this week.",
        attributes: { budget: "$4,000", timeline: "this week" },
      },
      rules,
    );
    assert.equal(r.ticketType, "GREEN");
    assert.ok(r.intentScore >= GREEN_THRESHOLD);
    assert.ok(r.signals.some((s) => s.startsWith("high-intent service")));
    assert.equal(r.classifier, "stub");
  });

  it("classifies a supplier invoice as RED", () => {
    const r = scoreLead(
      {
        source: "WEB_FORM",
        email: "sales@supplier.example.com",
        message: "Please find attached our invoice for October from your supplier.",
        attributes: {},
      },
      rules,
    );
    assert.equal(r.ticketType, "RED");
    assert.ok(r.intentScore < GREEN_THRESHOLD);
  });

  it("penalises leads with no contact details", () => {
    const withContact = scoreLead({ source: "WEB_FORM", email: "a@b.co", message: "quote please", attributes: {} }, {});
    const without = scoreLead({ source: "WEB_FORM", message: "quote please", attributes: {} }, {});
    assert.ok(without.intentScore < withContact.intentScore);
  });

  it("rewards budgets at or above the tenant minimum and penalises those below", () => {
    const above = scoreLead({ source: "WEB_FORM", email: "a@b.co", attributes: { budget: 900 } }, { minBudget: 500 });
    const below = scoreLead({ source: "WEB_FORM", email: "a@b.co", attributes: { budget: 100 } }, { minBudget: 500 });
    assert.ok(above.intentScore > below.intentScore);
    assert.ok(above.signals.some((s) => s.includes("≥ tenant minimum")));
  });

  it("treats a lead with no signals as RED by default", () => {
    const r = scoreLead({ source: "OTHER", email: "x@y.z", message: "hello", attributes: {} }, {});
    assert.equal(r.ticketType, "RED");
  });

  it("clamps the score to 0–100", () => {
    const hot = scoreLead(
      {
        source: "PHONE",
        phone: "1",
        email: "a@b.co",
        message: "book consultation quote buy order deposit asap urgent dental implants",
        attributes: { budget: 99999, timeline: "today" },
      },
      rules,
    );
    assert.ok(hot.intentScore <= 100);
    const cold = scoreLead(
      { source: "OTHER", message: "invoice receipt unsubscribe complaint refund cancel job career", attributes: {} },
      {},
    );
    assert.ok(cold.intentScore >= 0);
  });
});
