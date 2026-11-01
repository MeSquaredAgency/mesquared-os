import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { repository } from "@/lib/data";
import { demoTenants } from "@/lib/data/fixtures";
import { countsAsHandled, describeHandled } from "@/lib/portal/handled";

const tenant = demoTenants[0];
const opts = { timezone: tenant.timezone, currency: tenant.currency, onlyAssigneeId: null, canViewFinances: false };

describe("what counts as handled for the client", () => {
  it("counts sent and completed work, not write-offs, failures, escalations or syncs", () => {
    assert.equal(countsAsHandled({ typeKey: "enquiry_auto_reply", outcome: "SENT" }), true);
    assert.equal(countsAsHandled({ typeKey: "sla_watch", outcome: "COMPLETED" }), true);
    assert.equal(countsAsHandled({ typeKey: "sla_watch", outcome: "SKIPPED" }), false);
    assert.equal(countsAsHandled({ typeKey: "social_publish", outcome: "FAILED" }), false);
    assert.equal(countsAsHandled({ typeKey: "inbox_triage", outcome: "ESCALATED" }), false);
    assert.equal(countsAsHandled({ typeKey: "finance_sync", outcome: "COMPLETED" }), false);
  });

  it("keeps operator write-offs out of the portal home's counts and feed", async () => {
    const before = await repository.getPortalHome(tenant.id, opts);
    for (let i = 0; i < 5; i++) await repository.recordAutomationRun(tenant.id, { typeKey: "sla_watch", outcome: "SKIPPED", summary: "Closed by the Me² team: no longer relevant." });
    await repository.recordAutomationRun(tenant.id, { typeKey: "finance_sync", outcome: "COMPLETED", summary: "Pulled 3 payments." });
    await repository.recordAutomationRun(tenant.id, { typeKey: "enquiry_auto_reply", outcome: "SENT", summary: "Replied to a new enquiry." });
    const after = await repository.getPortalHome(tenant.id, opts);
    assert.equal(after.handled.countToday, before.handled.countToday + 1);
    assert.equal(after.handled.countWeek, before.handled.countWeek + 1);
    assert.equal(after.handled.byType.reduce((s, t) => s + t.count, 0), after.handled.countWeek);
    assert.ok(after.handled.runs.every(countsAsHandled), "the feed only shows handled work");
  });
});

describe("describeHandled", () => {
  it("says what was done, biggest first, in plain words", () => {
    assert.equal(
      describeHandled([
        { typeKey: "review_request", count: 2 },
        { typeKey: "enquiry_auto_reply", count: 14 },
        { typeKey: "booking_lifecycle", count: 1 },
        { typeKey: "reactivation", count: 1 },
      ]),
      "replied to 14 enquiries, asked 2 customers for a review and sent 1 booking confirmation or reminder",
    );
    assert.equal(describeHandled([{ typeKey: "sla_watch", count: 1 }]), "won back 1 lead that was slipping");
    assert.equal(describeHandled([{ typeKey: "finance_sync", count: 9 }]), null);
    assert.equal(describeHandled([]), null);
  });
});
