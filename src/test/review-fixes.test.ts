import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { registerAutomations } from "@/lib/automations/handlers";
import { repository } from "@/lib/data";
import { demoTenants } from "@/lib/data/fixtures";
import { platformReadiness, tenantReadiness } from "@/lib/launch/readiness";
import { raiseMissedOpportunity } from "@/lib/opportunities/raise";
import { registerPlaybook, runGreenLeadPlaybook } from "@/lib/playbook";
import { resolveTenantFromRequest } from "@/lib/tenant/resolve";
import { localInputToDate } from "@/lib/utils";
import type { NextRequest } from "next/server";

/**
 * Regression tests for the high-priority findings of the pre-launch review
 * (docs/reviews/2026-10-25-pre-launch-review.md).
 */

const harbor = demoTenants[0];

const baseLead = {
  contactId: null,
  source: "WEB_FORM" as const,
  firstName: null,
  lastName: null,
  email: null as string | null,
  phone: null as string | null,
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

before(() => {
  process.env.MESSAGING_MODE = "log";
  process.env.DEFAULT_FROM_EMAIL ??= "hello@platform.example";
  registerPlaybook();
  registerAutomations();
});

describe("review: own-records-only members see only their own leads' activity", () => {
  it("filters missed opportunities, the activity log and the portal home by assignee", async () => {
    const contact = await repository.upsertContact(harbor.id, { firstName: "Own", lastName: "Records", email: "own-records@example.com", phone: null, company: null });
    const mine = (await repository.createLead(harbor.id, { ...baseLead, contactId: contact.id, email: contact.email, externalId: "review:own:1" })).lead;
    const theirs = (await repository.createLead(harbor.id, { ...baseLead, contactId: contact.id, email: contact.email, externalId: "review:own:2" })).lead;
    await repository.assignLead(harbor.id, mine.id, "user_pm");
    await repository.assignLead(harbor.id, theirs.id, "user_director");
    await raiseMissedOpportunity(harbor, { type: "UNANSWERED_ENQUIRY", leadId: mine.id, contactId: contact.id, subjectId: mine.id, summary: "Mine went unanswered", suggestedAction: "Call them" });
    await raiseMissedOpportunity(harbor, { type: "UNANSWERED_ENQUIRY", leadId: theirs.id, contactId: contact.id, subjectId: theirs.id, summary: "Theirs went unanswered", suggestedAction: "Call them" });
    await repository.recordAutomationRun(harbor.id, { typeKey: "enquiry_auto_reply", outcome: "SENT", summary: "Run on mine", leadId: mine.id, contactId: contact.id });
    await repository.recordAutomationRun(harbor.id, { typeKey: "enquiry_auto_reply", outcome: "SENT", summary: "Run on theirs", leadId: theirs.id, contactId: contact.id });

    const all = await repository.listMissedOpportunities(harbor.id, { limit: 200 });
    assert.ok(all.some((m) => m.leadId === mine.id) && all.some((m) => m.leadId === theirs.id), "a director sees both");
    const own = await repository.listMissedOpportunities(harbor.id, { limit: 200, onlyAssigneeId: "user_pm" });
    assert.ok(own.some((m) => m.leadId === mine.id), "own lead's item is listed");
    assert.ok(own.every((m) => m.leadId === mine.id), "nothing from anyone else's lead, and nothing without a lead");

    const ownRuns = await repository.listAutomationRuns(harbor.id, 200, { onlyAssigneeId: "user_pm" });
    assert.ok(ownRuns.some((r) => r.summary === "Run on mine"));
    assert.ok(!ownRuns.some((r) => r.summary === "Run on theirs"), "a colleague's lead activity is not listed");
    for (const r of ownRuns) {
      assert.ok(r.leadId, "runs without a lead are hidden from own-records-only members");
      assert.equal((await repository.findLeadById(harbor.id, r.leadId))?.assigneeId, "user_pm", "every listed run is on one of the member's own leads");
    }

    const home = await repository.getPortalHome(harbor.id, { timezone: harbor.timezone, currency: harbor.currency, onlyAssigneeId: "user_pm", canViewFinances: false });
    assert.ok(!home.missed.open.some((m) => m.leadId === theirs.id), "portal home missed list is filtered too");
    assert.ok(!home.handled.runs.some((r) => r.summary === "Run on theirs"), "portal home activity is filtered too");
  });
});

describe("review: a number the workspace may not text does not block the email", () => {
  it("acknowledges by email when the phone is overseas, and says why when there is no email", async () => {
    const overseas = await repository.upsertContact(harbor.id, { firstName: "Imogen", lastName: null, email: "imogen@example.co.uk", phone: "+447700900123", company: null });
    const lead = (await repository.createLead(harbor.id, { ...baseLead, contactId: overseas.id, email: overseas.email, phone: overseas.phone, ticketType: "GREEN", intentScore: 90, externalId: "review:overseas:1", respondBy: new Date(Date.now() + 600_000), bookBy: new Date(Date.now() + 86_400_000) })).lead;
    await runGreenLeadPlaybook(harbor, lead);
    const runs = await repository.listAutomationRuns(harbor.id, 20);
    const ack = runs.find((r) => r.leadId === lead.id && r.typeKey === "enquiry_auto_reply" && /Acknowledged/.test(r.summary));
    assert.ok(ack, "an acknowledgement run exists");
    assert.equal(ack.outcome, "SENT");
    assert.match(ack.summary, /by email/, "went by email, not reported as a failed text");

    const phoneOnly = await repository.upsertContact(harbor.id, { firstName: "Niall", lastName: null, email: null, phone: "+447700900124", company: null });
    const lead2 = (await repository.createLead(harbor.id, { ...baseLead, contactId: phoneOnly.id, phone: phoneOnly.phone, ticketType: "GREEN", intentScore: 90, externalId: "review:overseas:2", respondBy: new Date(Date.now() + 600_000), bookBy: new Date(Date.now() + 86_400_000) })).lead;
    await runGreenLeadPlaybook(harbor, lead2);
    const skipped = (await repository.listAutomationRuns(harbor.id, 20)).find((r) => r.leadId === lead2.id && r.typeKey === "enquiry_auto_reply" && r.outcome === "SKIPPED");
    assert.ok(skipped, "logged as skipped, not failed");
    assert.match(skipped.summary, /outside the countries/);
  });
});

describe("review: readiness checks can fail for the things that matter", () => {
  it("no longer passes booking unconditionally and only counts the workspace's own SMS number", async () => {
    const prev = process.env.DEFAULT_FROM_NUMBER;
    const prevMode = process.env.MESSAGING_MODE;
    process.env.DEFAULT_FROM_NUMBER = "+61400000999";
    process.env.MESSAGING_MODE = "live";
    try {
      const checks = await tenantReadiness(demoTenants[1]);
      const booking = checks.find((c) => c.key === "booking")!;
      assert.equal(booking.level, "recommended");
      assert.equal(booking.ok, false, "no Cal.com integration on the fitness demo tenant");
      const messaging = checks.find((c) => c.key === "messaging")!;
      assert.match(messaging.detail, /attach the workspace's own SMS number|Email only|No sender/, "a platform-wide number does not count as the workspace's sender");
    } finally {
      if (prev === undefined) delete process.env.DEFAULT_FROM_NUMBER;
      else process.env.DEFAULT_FROM_NUMBER = prev;
      process.env.MESSAGING_MODE = prevMode;
    }
  });

  it("requires the from-address, matching Twilio webhook URL, recent tick and (in production) every webhook secret", () => {
    const base = { AUTH_SECRET: "x".repeat(40), INTEGRATION_ENCRYPTION_KEY: "y".repeat(32), JOB_SECRET: "z", NEXT_PUBLIC_APP_URL: "https://app.example.com", MESSAGING_MODE: "live", TWILIO_ACCOUNT_SID: "AC1" };
    const bare = platformReadiness(base, { lastTickAt: null });
    const by = (checks: ReturnType<typeof platformReadiness>, key: string) => checks.find((c) => c.key === key)!;
    assert.equal(by(bare, "from-email").ok, false);
    assert.equal(by(bare, "from-email").level, "required");
    assert.equal(by(bare, "twilio-webhook-url").ok, false, "Twilio configured but no webhook URL");
    assert.equal(by(bare, "tick-recent").ok, false, "no tick recorded");
    assert.equal(by(bare, "webhook-secrets").level, "recommended", "outside production the secrets are recommended");
    assert.equal(by(platformReadiness({ ...base, NODE_ENV: "production" }), "webhook-secrets").level, "required");
    assert.match(by(platformReadiness({ ...base, NODE_ENV: "production" }), "webhook-secrets").detail, /META_WEBHOOK_VERIFY_TOKEN/);

    const now = new Date("2026-01-15T12:30:00Z");
    const good = platformReadiness({ ...base, DEFAULT_FROM_EMAIL: "hello@example.com", TWILIO_WEBHOOK_URL: "https://app.example.com/api/v1/inbound/sms", INVENTORY_MODE: "live" }, { lastTickAt: new Date(now.getTime() - 60_000), now });
    assert.equal(by(good, "from-email").ok, true);
    assert.equal(by(good, "twilio-webhook-url").ok, true);
    assert.equal(by(good, "tick-recent").ok, true);
    assert.equal(by(platformReadiness({ ...base, TWILIO_WEBHOOK_URL: "https://other.example.com/api/v1/inbound/sms" }), "twilio-webhook-url").ok, false, "a different host fails");
    assert.equal(by(platformReadiness({ ...base, INVENTORY_MODE: "log" }), "ads-finance-live").ok, false, "inventory log mode is reported");
    assert.equal(by(platformReadiness(base, { lastTickAt: new Date(now.getTime() - 6 * 60_000), now }), "tick-recent").ok, false, "a six-minute-old tick is stale");
  });
});

describe("review: console scheduling is read in the client's timezone", () => {
  it("turns a datetime-local value into the instant that time means in the tenant's zone", () => {
    // 09:00 in Adelaide on 15 January 2026 (ACDT, +10:30) is 22:30 UTC the day before.
    assert.equal(localInputToDate("2026-01-15T09:00", "Australia/Adelaide")?.toISOString(), "2026-01-14T22:30:00.000Z");
    // The same wall-clock time in London is a different instant.
    assert.equal(localInputToDate("2026-01-15T09:00", "Europe/London")?.toISOString(), "2026-01-15T09:00:00.000Z");
    // An ISO instant with an offset is taken as is.
    assert.equal(localInputToDate("2026-01-15T09:00:00Z", "Australia/Adelaide")?.toISOString(), "2026-01-15T09:00:00.000Z");
    assert.equal(localInputToDate("", "Australia/Adelaide"), null);
    assert.equal(localInputToDate("next tuesday", "Australia/Adelaide"), null);
  });
});

describe("review: abandoned-form detection only looks at sessions with a way to reach the person", () => {
  it("skips detail-less sessions however many there are", async () => {
    for (let i = 0; i < 5; i++) await repository.upsertFormSession(harbor.id, { sessionKey: `review:blank:${i}`, formName: "contact", pageUrl: "/contact", partial: { name: "Only a name" } });
    await repository.upsertFormSession(harbor.id, { sessionKey: "review:email", formName: "contact", pageUrl: "/contact", partial: { name: "Reachable", email: "reach@example.com" } });
    // Everything above is "idle" relative to a moment just ahead of now; the blank ones are older in insertion order.
    const found = await repository.listAbandonedFormSessions(harbor.id, new Date(Date.now() + 1000), 3);
    assert.ok(found.some((f) => f.sessionKey === "review:email"), "the reachable session is found even when older blank ones exist");
    assert.ok(found.every((f) => typeof f.partial.email === "string" || typeof f.partial.phone === "string"));
  });
});

describe("review: the public intake key cannot drive the call and review connectors", () => {
  it("refuses an intake-only key for the webhooks scope", async () => {
    const req = { headers: new Headers({ "x-api-key": "msq_live_demo_one_0000000000000000" }) } as unknown as NextRequest;
    const intake = await resolveTenantFromRequest(req, "intake");
    assert.equal(intake.ok, true);
    const webhooks = await resolveTenantFromRequest(req, "webhooks");
    assert.equal(webhooks.ok, false);
    assert.equal(webhooks.ok === false && webhooks.status, 403);
    assert.match(webhooks.ok === false ? webhooks.error : "", /webhooks/);
  });
});
