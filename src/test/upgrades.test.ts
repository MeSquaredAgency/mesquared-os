import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { registerAutomations } from "@/lib/automations/handlers";
import { settleException } from "@/lib/console/resolve";
import { repository } from "@/lib/data";
import { demoTenants } from "@/lib/data/fixtures";
import { isApiKeyScope } from "@/lib/data/repository";
import { emit } from "@/lib/events";
import { healthBreakdown, healthScore, healthTitle } from "@/lib/health";
import { ingestMetaLead } from "@/lib/intake/channels/meta-lead";
import { retryDelayMs, tick } from "@/lib/jobs/tick";
import { sendMessage } from "@/lib/messaging";
import { isStartMessage, isStopMessage } from "@/lib/messaging/keywords";
import { detectForTenant } from "@/lib/opportunities/detect";
import { escalateeFor, raiseMissedOpportunity } from "@/lib/opportunities/raise";
import { registerPlaybook } from "@/lib/playbook";
import type { TenantSummary } from "@/lib/types";
import { monthProgressInZone } from "@/lib/utils";

/**
 * Regression tests for the November 2026 upgrade pass: production API-key
 * scopes, escalation isolation, SLA items that stay closed, opt-outs that are
 * honoured everywhere, pacing on the tenant's calendar, recovered value that
 * follows the person back, and paid leads that survive a Graph API hiccup.
 */

const harbor = demoTenants[0];
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const greenLead = {
  contactId: null as string | null,
  source: "WEB_FORM" as const,
  firstName: "Upgrade",
  lastName: "Test",
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
  process.env.DEFAULT_FROM_NUMBER ??= "+61400000000";
  registerPlaybook();
  registerAutomations();
});

describe("API key scopes", () => {
  it("keeps the webhooks scope, which call-tracking and review connectors need", () => {
    assert.deepEqual(["intake", "content", "webhooks", "admin", 3].filter(isApiKeyScope), ["intake", "content", "webhooks"]);
  });
});

describe("escalation to a named client person", () => {
  const withRules = (rules: TenantSummary["escalationRules"]): TenantSummary => ({ ...harbor, escalationRules: rules });

  it("prefers the rule for the exact type over the catch-all", async () => {
    const tenant = withRules([
      { when: "*", notifyUserId: "user_pm" },
      { when: "NOT_BOOKED", notifyUserId: "user_director" },
    ]);
    assert.equal((await escalateeFor(tenant, "NOT_BOOKED"))?.userId, "user_director");
    assert.equal((await escalateeFor(tenant, "UNANSWERED_ENQUIRY"))?.userId, "user_pm");
  });

  it("never tells someone who is not a member of the workspace", async () => {
    // user_ops is a Me² operator on the workspace, not a member; user_summit_owner belongs to another tenant.
    assert.equal(await escalateeFor(withRules([{ when: "*", notifyUserId: "user_ops" }]), "NOT_BOOKED"), null);
    assert.equal(await escalateeFor(withRules([{ when: "*", notifyUserId: "user_summit_owner" }]), "NOT_BOOKED"), null);
    assert.equal(await escalateeFor(withRules([{ when: "*", notifyUserId: "user_nobody" }]), "NOT_BOOKED"), null);
  });
});

describe("SLA items stay settled once a person deals with them", () => {
  it("marking an unanswered enquiry recovered stops the response clock on the lead", async () => {
    const contact = await repository.upsertContact(harbor.id, { firstName: "Settled", lastName: "Lead", email: "settled@example.com", phone: null, company: null });
    const now = new Date();
    const { lead } = await repository.createLead(harbor.id, { ...greenLead, contactId: contact.id, email: contact.email, externalId: "upgrade:settle:1", respondBy: new Date(now.getTime() - 10 * MINUTE), bookBy: new Date(now.getTime() + 24 * HOUR) });
    const raised = await raiseMissedOpportunity(harbor, { type: "UNANSWERED_ENQUIRY", leadId: lead.id, contactId: contact.id, subjectId: lead.id, summary: "No reply", suggestedAction: "Call" });
    assert.ok(raised);
    const ex = (await repository.listExceptions([harbor.id])).find((e) => e.missedOpportunityId === raised!.id);
    assert.ok(ex, "exception raised");

    assert.ok((await repository.listLeadsPastSla(harbor.id, now)).respond.some((l) => l.id === lead.id), "breached before");
    await settleException(harbor.id, ex!.id, "Called them", true, "user_ops");

    const after = await repository.findLeadById(harbor.id, lead.id);
    assert.ok(after?.firstResponseAt, "the lead now counts as answered");
    assert.ok(!(await repository.listLeadsPastSla(harbor.id, now)).respond.some((l) => l.id === lead.id), "no longer breached");
    assert.equal((await repository.findMissedOpportunityById(harbor.id, raised!.id))?.status, "RECOVERED");
  });

  it("closing a never-booked item stops the booking clock without inventing a booking", async () => {
    const contact = await repository.upsertContact(harbor.id, { firstName: "Never", lastName: "Booked", email: "never-booked@example.com", phone: null, company: null });
    const now = new Date();
    const { lead } = await repository.createLead(harbor.id, { ...greenLead, contactId: contact.id, email: contact.email, externalId: "upgrade:settle:2", respondBy: new Date(now.getTime() - 2 * HOUR), bookBy: new Date(now.getTime() - HOUR) });
    await repository.markLeadResponded(harbor.id, lead.id, new Date(now.getTime() - 90 * MINUTE));
    const raised = await raiseMissedOpportunity(harbor, { type: "NOT_BOOKED", leadId: lead.id, contactId: contact.id, subjectId: lead.id, summary: "Not booked", suggestedAction: "Call" });
    const ex = (await repository.listExceptions([harbor.id])).find((e) => e.missedOpportunityId === raised!.id);
    await settleException(harbor.id, ex!.id, "Not interested", false, "user_ops");
    const after = await repository.findLeadById(harbor.id, lead.id);
    assert.equal(after?.bookedAt, null, "no booking was invented");
    assert.equal(after?.bookBy, null, "the booking window is closed");
    assert.ok(!(await repository.listLeadsPastSla(harbor.id, now)).book.some((l) => l.id === lead.id), "not raised again");
  });
});

describe("one open item per lead: unanswered beats never-booked", () => {
  it("does not raise NOT_BOOKED while the same lead's UNANSWERED_ENQUIRY is open", async () => {
    const contact = await repository.upsertContact(harbor.id, { firstName: "Double", lastName: "Count", email: "double-count@example.com", phone: null, company: null });
    const now = new Date();
    const { lead } = await repository.createLead(harbor.id, { ...greenLead, contactId: contact.id, email: contact.email, externalId: "upgrade:double:1", respondBy: new Date(now.getTime() - 3 * HOUR), bookBy: new Date(now.getTime() - HOUR) });
    const result = await detectForTenant(harbor, now);
    const mine = result.detected.filter((d) => d.subjectId === lead.id).map((d) => d.type);
    assert.deepEqual(mine, ["UNANSWERED_ENQUIRY"]);
  });
});

describe("opt-outs are final", () => {
  it("recognises only whole-message keywords", () => {
    assert.ok(isStopMessage("STOP"));
    assert.ok(isStopMessage(" stop. "));
    assert.ok(isStopMessage("Unsubscribe"));
    assert.ok(!isStopMessage("Cancel my appointment please"));
    assert.ok(!isStopMessage("Please stop sending the brochure, just call me"));
    assert.ok(isStartMessage("START"));
    assert.ok(!isStartMessage("Yes, Tuesday works"));
  });

  it("refuses every automated message to a contact who opted out, whatever the region or the reason", async () => {
    const contact = await repository.upsertContact(harbor.id, { firstName: "Opted", lastName: "Out", email: null, phone: "+61400777888", company: null });
    await repository.setContactConsent(harbor.id, contact.id, "sms", false, "STOP reply");
    const marketing = await sendMessage({ tenant: harbor, contactId: contact.id, channel: "SMS", to: contact.phone!, body: "A review would help us", transactional: false });
    assert.equal(marketing.ok, false);
    assert.match(marketing.error ?? "", /opted out/);
    const transactional = await sendMessage({ tenant: harbor, contactId: contact.id, channel: "SMS", to: contact.phone!, body: "Thanks for your enquiry", transactional: true });
    assert.equal(transactional.ok, false, "transactional texts stop too once they said stop");
    assert.match(transactional.error ?? "", /opted out/);
  });
});

describe("health score explains itself", () => {
  const base = { tenant: harbor, slaBreaches: 0, missedOpen: 0, exceptionsOpen: 0, missedAtRiskCents: 0, contentDue: 0, adPacing: null, integrations: [], leadsToday: 0 };

  it("lists each deduction in words and sums to the score", () => {
    const row = { ...base, slaBreaches: 2, exceptionsOpen: 1, integrations: [{ provider: "META" as const, status: "DISCONNECTED" as const, lastError: null }] };
    const deductions = healthBreakdown(row);
    assert.deepEqual(
      deductions.map((d) => [d.label, d.points]),
      [
        ["2 SLA breaches", 20],
        ["1 exception", 4],
        ["1 failing integration", 8],
      ],
    );
    assert.equal(healthScore(row), 68);
    assert.match(healthTitle(68, deductions), /68 of 100: Watch\. 2 SLA breaches \(−20\)/);
  });

  it("caps each dimension so one problem cannot hide another", () => {
    const row = { ...base, slaBreaches: 50 };
    assert.equal(healthBreakdown(row)[0].points, 30);
    assert.equal(healthScore(row), 70);
    assert.deepEqual(healthBreakdown(base), []);
    assert.equal(healthScore(base), 100);
  });

  it("flags pacing from the tenant's month, not the server's", () => {
    const row = { ...base, adPacing: { spentCents: 90_000, budgetCents: 100_000, daysElapsed: 10, daysInMonth: 30 } };
    assert.match(healthBreakdown(row)[0].label, /ad spend over plan by 170%/);
  });
});

describe("month progress follows the tenant's calendar", () => {
  it("is day 1 of November in Adelaide while the server is still on 31 October", () => {
    const instant = new Date("2026-10-31T14:00:00Z"); // 00:30 on 1 November, Adelaide daylight time
    assert.deepEqual(monthProgressInZone("Australia/Adelaide", instant), { daysElapsed: 1, daysInMonth: 30 });
    assert.deepEqual(monthProgressInZone("UTC", instant), { daysElapsed: 31, daysInMonth: 31 });
  });

  it("knows the length of every month", () => {
    assert.equal(monthProgressInZone("UTC", new Date("2028-02-10T12:00:00Z")).daysInMonth, 29);
    assert.equal(monthProgressInZone("UTC", new Date("2026-02-10T12:00:00Z")).daysInMonth, 28);
  });
});

describe("recovered value follows the person back", () => {
  it("a booking recovers the lead's never-booked item", async () => {
    const contact = await repository.upsertContact(harbor.id, { firstName: "Came", lastName: "Back", email: "came-back@example.com", phone: null, company: null });
    const { lead } = await repository.createLead(harbor.id, { ...greenLead, contactId: contact.id, email: contact.email, externalId: "upgrade:recover:1" });
    const raised = await raiseMissedOpportunity(harbor, { type: "NOT_BOOKED", leadId: lead.id, contactId: contact.id, subjectId: lead.id, summary: "Not booked", suggestedAction: "Call" });
    assert.ok(raised);
    await emit(harbor.id, "booking.created", { bookingId: "bk_test", leadId: lead.id, startsAt: null, endsAt: null, provider: "CALCOM", rescheduled: false });
    const after = await repository.findMissedOpportunityById(harbor.id, raised!.id);
    assert.equal(after?.status, "RECOVERED");
    assert.equal(after?.recoveredValueCents, raised!.estimatedValueCents);
    const runs = await repository.listAutomationRuns(harbor.id, 50);
    assert.ok(runs.some((r) => r.missedOpportunityId === raised!.id && /booked a time/.test(r.summary)), "the activity log says why");
  });

  it("a new enquiry recovers an abandoned form; a payment recovers a quiet quote at the paid amount", async () => {
    const contact = await repository.upsertContact(harbor.id, { firstName: "Form", lastName: "Finisher", email: "form-finisher@example.com", phone: null, company: null });
    const abandoned = await raiseMissedOpportunity(harbor, { type: "ABANDONED_FORM", leadId: null, contactId: contact.id, subjectId: "fs_test", summary: "Started a form", suggestedAction: "Nudge" });
    const quiet = await raiseMissedOpportunity(harbor, { type: "QUIET_QUOTE", leadId: null, contactId: contact.id, subjectId: "quote_test", summary: "Quote gone quiet", suggestedAction: "Nudge" });
    await emit(harbor.id, "intake.received", { leadId: "lead_x", contactId: contact.id, channel: "WEB_FORM", source: "WEB_FORM" });
    assert.equal((await repository.findMissedOpportunityById(harbor.id, abandoned!.id))?.status, "RECOVERED");
    assert.equal((await repository.findMissedOpportunityById(harbor.id, quiet!.id))?.status, "ESCALATED", "an enquiry is not a payment");
    await emit(harbor.id, "invoice.paid", { invoiceId: "inv_test", amountCents: 123_400, provider: "MANUAL", contactId: contact.id });
    const paid = await repository.findMissedOpportunityById(harbor.id, quiet!.id);
    assert.equal(paid?.status, "RECOVERED");
    assert.equal(paid?.recoveredValueCents, 123_400, "the real amount, not the estimate");
  });
});

describe("paid Meta leads survive a Graph API failure", () => {
  const realFetch = globalThis.fetch;
  let graphCalls = 0;
  let graphUp = false;
  before(() => {
    process.env.META_PAGE_ACCESS_TOKEN ??= "test-token";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (!url.startsWith("https://graph.facebook.com/")) return realFetch(input, init);
      graphCalls++;
      if (!graphUp) throw new Error("socket hang up");
      return new Response(JSON.stringify({ created_time: "2026-11-01T00:00:00+0000", field_data: [{ name: "full_name", values: ["Lena Graph"] }, { name: "email", values: ["lena.graph@example.com"] }, { name: "phone_number", values: ["+61400999000"] }] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
  });
  after(() => {
    globalThis.fetch = realFetch;
  });

  it("queues a retry when the fetch fails, then creates the lead when it succeeds", async () => {
    const ref = { leadgenId: "lg_upgrade_1", pageId: "page_1", adId: "ad_9", formId: "form_9" };
    assert.equal(await ingestMetaLead(harbor, ref), "retry_scheduled");
    const due = (await repository.listDueActions(new Date(Date.now() + HOUR), 500)).find((a) => a.dedupeKey === "meta:lead:lg_upgrade_1");
    assert.ok(due, "retry queued");
    assert.equal(due!.typeKey, "meta_lead");

    // Graph still down: the tick's retry fails and backs off instead of giving up.
    let now = new Date(Date.now() + 3 * MINUTE);
    await tick(now);
    const retried = (await repository.listDueActions(new Date(now.getTime() + 24 * HOUR), 500)).find((a) => a.dedupeKey === "meta:lead:lg_upgrade_1");
    assert.ok(retried, "still pending after a transient failure");
    assert.equal(retried!.attempts, 1);

    // Graph back: the lead comes through intake with its leadgen id as the external id.
    graphUp = true;
    now = new Date(retried!.runAt.getTime() + MINUTE);
    await tick(now);
    const lead = (await repository.listRecentLeads(harbor.id, 200)).find((l) => l.externalId === "meta:lg_upgrade_1");
    assert.ok(lead, "lead created on retry");
    assert.equal(lead!.source, "META_LEAD_FORM");
    assert.ok(graphCalls >= 3);
    assert.equal((await repository.listDueActions(new Date(now.getTime() + 24 * HOUR), 500)).some((a) => a.dedupeKey === "meta:lead:lg_upgrade_1"), false, "nothing left in the queue");
  });

  it("retries back off: 5, 10, 20 minutes plus jitter", () => {
    const noJitter = () => 0;
    assert.equal(retryDelayMs(1, noJitter), 5 * MINUTE);
    assert.equal(retryDelayMs(2, noJitter), 10 * MINUTE);
    assert.equal(retryDelayMs(3, noJitter), 20 * MINUTE);
    assert.ok(retryDelayMs(1) >= 5 * MINUTE && retryDelayMs(1) < 6 * MINUTE);
  });
});
