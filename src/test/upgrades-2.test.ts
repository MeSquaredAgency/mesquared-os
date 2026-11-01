import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { registerAutomations } from "@/lib/automations/handlers";
import { repository } from "@/lib/data";
import { demoTenants } from "@/lib/data/fixtures";
import { errorText, log } from "@/lib/log";
import { expireStaleOpportunities } from "@/lib/opportunities/expire";
import { raiseMissedOpportunity } from "@/lib/opportunities/raise";
import { registerPlaybook } from "@/lib/playbook";

/**
 * Second upgrade batch: payments shown against the lead, the daily expiry
 * sweep for items nobody could recover, and one-line JSON logs.
 */

const harbor = demoTenants[0];
const DAY = 86_400_000;

const greenLead = {
  contactId: null as string | null,
  source: "WEB_FORM" as const,
  firstName: "Batch",
  lastName: "Two",
  email: null as string | null,
  phone: null as string | null,
  company: null,
  message: "Testing",
  attributes: {},
  attribution: {},
  ticketType: "GREEN" as const,
  intentScore: 80,
  qualificationReason: "test",
  qualifiedBy: "stub",
  pipelineId: null,
  stageId: null,
  valueCents: 50_000,
  respondBy: null as Date | null,
  bookBy: null as Date | null,
};

before(() => {
  process.env.MESSAGING_MODE = "log";
  process.env.DEFAULT_FROM_EMAIL ??= "hello@platform.example";
  registerPlaybook();
  registerAutomations();
});

describe("payments show against the lead", () => {
  it("links a provider transaction to the contact's latest live lead, never a lost one", async () => {
    const contact = await repository.upsertContact(harbor.id, { firstName: "Paying", lastName: "Customer", email: "paying@example.com", phone: null, company: null });
    const lost = (await repository.createLead(harbor.id, { ...greenLead, contactId: contact.id, email: contact.email, externalId: "b2:pay:lost" })).lead;
    await repository.setLeadStatus(harbor.id, lost.id, "LOST");
    const live = (await repository.createLead(harbor.id, { ...greenLead, contactId: contact.id, email: contact.email, externalId: "b2:pay:live" })).lead;

    const now = new Date();
    await repository.upsertTransactions(harbor.id, [{ provider: "STRIPE", providerId: "pi_b2_1", kind: "PAYMENT", status: "COMPLETED", amountCents: 45_000, currency: "AUD", occurredAt: now, customerEmail: "Paying@Example.com" }]);
    const [txn] = (await repository.listTransactions(harbor.id, { from: new Date(now.getTime() - 1000), limit: 50 })).filter((t) => t.providerId === "pi_b2_1");
    assert.equal(txn?.contactId, contact.id, "matched by email");
    assert.equal(txn?.leadId, live.id, "the live lead, not the lost one");

    // A second sync of the same payment keeps the link; an older unlinked row gains one.
    await repository.upsertTransactions(harbor.id, [{ provider: "STRIPE", providerId: "pi_b2_1", kind: "PAYMENT", status: "COMPLETED", amountCents: 45_000, currency: "AUD", occurredAt: now, customerEmail: "paying@example.com" }]);
    const again = (await repository.listTransactions(harbor.id, { from: new Date(now.getTime() - 1000), limit: 50 })).find((t) => t.providerId === "pi_b2_1");
    assert.equal(again?.leadId, live.id);
  });
});

describe("the expiry sweep", () => {
  it("closes open items older than the workspace's limit, leaves younger ones, and says so once", async () => {
    const contact = await repository.upsertContact(harbor.id, { firstName: "Long", lastName: "Gone", email: "long-gone@example.com", phone: null, company: null });
    const old = await raiseMissedOpportunity(harbor, { type: "MISSED_CALL", leadId: null, contactId: contact.id, subjectId: "b2:expire:old", summary: "Called in September", suggestedAction: "Call back" });
    const fresh = await raiseMissedOpportunity(harbor, { type: "MISSED_CALL", leadId: null, contactId: contact.id, subjectId: "b2:expire:fresh", summary: "Called today", suggestedAction: "Call back" });
    assert.ok(old && fresh);
    // Demo store: back-date the stale one past the default thirty days.
    old!.detectedAt = new Date(Date.now() - 45 * DAY);
    const openEx = (await repository.listExceptions([harbor.id])).find((e) => e.missedOpportunityId === old!.id);
    assert.ok(openEx, "the stale item has an open exception");

    const result = await expireStaleOpportunities(harbor);
    assert.ok(result.expired >= 1);
    assert.equal((await repository.findMissedOpportunityById(harbor.id, old!.id))?.status, "EXPIRED");
    assert.equal((await repository.findMissedOpportunityById(harbor.id, fresh!.id))?.status, "ESCALATED", "the recent one is still being chased");
    assert.equal((await repository.listExceptions([harbor.id])).some((e) => e.id === openEx!.id), false, "its exception left the queue with it");
    const runs = await repository.listAutomationRuns(harbor.id, 20);
    assert.ok(runs.some((r) => /older than 30 days/.test(r.summary) && /missed call/.test(r.summary)), "one plain line in the activity log");

    // Nothing stale left: the sweep is quiet, not noisy.
    const quiet = await expireStaleOpportunities(harbor);
    assert.equal(quiet.expired, 0);
  });

  it("does nothing when the workspace turns it off", async () => {
    const off = { ...harbor };
    await repository.setAutomation(harbor.id, "sla_watch", { settings: { expireAfterDays: 0 } });
    try {
      const result = await expireStaleOpportunities(off);
      assert.equal(result.expired, 0);
    } finally {
      await repository.setAutomation(harbor.id, "sla_watch", { settings: { unrepliedInboxMinutes: 120, unansweredReviewHours: 48 } });
    }
  });
});

describe("structured logs", () => {
  it("writes one JSON line with the level, the event and flat fields, and never a stack trace", () => {
    const lines: string[] = [];
    const original = console.error;
    console.error = (line: string) => void lines.push(line);
    try {
      log("error", "tick.action_failed", { tenantId: "t1", attempt: 2, final: false, skipped: undefined, error: errorText(new Error("boom\n    at somewhere")) });
    } finally {
      console.error = original;
    }
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
    assert.equal(parsed.level, "error");
    assert.equal(parsed.event, "tick.action_failed");
    assert.equal(parsed.tenantId, "t1");
    assert.equal(parsed.attempt, 2);
    assert.equal(parsed.error, "boom");
    assert.equal("skipped" in parsed, false, "undefined fields are dropped");
    assert.match(String(parsed.at), /^\d{4}-\d{2}-\d{2}T/);
  });
});
