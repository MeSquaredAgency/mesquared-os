import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { onMissedCall, registerAutomations, runScheduledAction } from "@/lib/automations/handlers";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { repository } from "@/lib/data";
import { demoTenants } from "@/lib/data/fixtures";
import { tick } from "@/lib/jobs/tick";
import { clampOutOfQuietHours, inQuietHours, quietHoursEnd, sendMessage } from "@/lib/messaging";
import { destinationAllowed } from "@/lib/messaging/policy";
import { scoreLead } from "@/lib/qualify/rules";
import { quoteUntrusted, safeName, safeTopic, whenPhrase } from "@/lib/messaging/templates";
import { raiseMissedOpportunity } from "@/lib/opportunities/raise";
import type { TenantSummary } from "@/lib/types";

const harbor = demoTenants[0];
const summit = demoTenants[1];

before(() => {
  process.env.MESSAGING_MODE = "log";
  process.env.DEFAULT_FROM_EMAIL = "hello@example.com";
  process.env.DEFAULT_FROM_NUMBER = "+15555550000";
  registerAutomations();
});

/** A copy of the tenant whose quiet hours cover (or avoid) right now. */
function withQuietHoursNow(tenant: TenantSummary, quietNow: boolean): TenantSummary {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: tenant.timezone, hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  const start = quietNow ? hour : (hour + 2) % 24;
  const end = quietNow ? (hour + 2) % 24 : (hour + 3) % 24;
  return { ...tenant, sla: { ...tenant.sla, quietHours: { start, end } } };
}

describe("untrusted text in messages", () => {
  it("only lets a plain first name into an outbound message", () => {
    assert.equal(safeName("margaret"), "Margaret");
    assert.equal(safeName("  O'Neil-Smith "), "O'Neil-Smith");
    assert.equal(safeName("Zoë"), "Zoë");
    assert.equal(safeName("VERIFY your account at http://evil.example"), null);
    assert.equal(safeName("Click here"), "Click"); // two words read as a name; sentences (4+ words) are refused above
    assert.equal(safeName("x".repeat(80)), null);
    assert.equal(safeName("12345"), null);
    assert.equal(safeName(null), null);
  });

  it("echoes a topic only when the tenant lists it as a service", () => {
    assert.equal(safeTopic("appraisal", ["Appraisal", "Property management"]), "Appraisal");
    assert.equal(safeTopic("send bitcoin to…", ["Appraisal"]), null);
    assert.equal(safeTopic("appraisal", undefined), null);
  });

  it("strips links and caps length when quoting a stranger to staff", () => {
    const q = quoteUntrusted("Please pay at https://evil.example/pay now   or www.evil.example", 60);
    assert.ok(!q.includes("http") && !q.includes("www."));
    assert.ok(q.length <= 60);
  });

  it("formats appointment times for an older reader", () => {
    const when = whenPhrase(harbor, new Date("2026-11-03T23:30:00Z")); // 10:00 am Adelaide (ACDT) on Wednesday 4 November
    assert.match(when ?? "", /^on Wednesday 4 November at 10:00 am$/i);
  });
});

describe("the rule engine explains itself in the client's words", () => {
  const rules = { serviceAreas: ["Norwood", "Adelaide"], highIntentServices: ["appraisal"], requirePhone: true };
  it("gives a plain reason with no score or weights", () => {
    const green = scoreLead({ source: "WEB_FORM", message: "Thinking of selling my house in Norwood, can I get an appraisal?", phone: "+61400111222", email: null, attributes: {} }, rules);
    assert.equal(green.ticketType, "GREEN");
    assert.doesNotMatch(green.reason, /score|\(\+|\(-|queue|intent detected/i);
    assert.match(green.reason, /^Looks like real business: .*asks about appraisal.*left a phone number.*is in Norwood\.$/);
    const routine = scoreLead({ source: "WEB_FORM", message: "TESTING SMS API", phone: "+85512345678", email: null, attributes: {} }, rules);
    assert.equal(routine.ticketType, "RED");
    assert.match(routine.reason, /^Reads as a routine question rather than a sale: left a phone number\.$/);
    assert.ok(routine.signals.some((s) => /\(\+10\)/.test(s)), "operators keep the weighted signals");
  });
});

describe("destination and consent policy inside sendMessage", () => {
  it("allows only the tenant's own country for phone destinations", () => {
    assert.equal(destinationAllowed(harbor, "+61400111222"), true);
    assert.equal(destinationAllowed(harbor, "+8801700000000"), false);
    assert.equal(destinationAllowed(harbor, "0400111222"), false);
    assert.equal(destinationAllowed({ region: "KH" }, "+85512345678"), true);
  });

  it("refuses an overseas SMS and records the refusal on the conversation", async () => {
    const contact = await repository.upsertContact(harbor.id, { firstName: "Far", lastName: null, email: null, phone: "+8801700000001", company: null });
    const r = await sendMessage({ tenant: harbor, contactId: contact.id, channel: "SMS", to: contact.phone!, body: "hi", transactional: true });
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /outside the countries/);
    assert.ok(r.messageId, "the refusal is still recorded");
  });

  it("needs recorded consent for marketing SMS in the US, not for a transactional reply", async () => {
    const us: TenantSummary = { ...summit, region: "US", sla: { ...summit.sla, quietHours: { start: 0, end: 0 } } };
    const contact = await repository.upsertContact(summit.id, { firstName: "Casey", lastName: null, email: null, phone: "+14155550100", company: null });
    const marketing = await sendMessage({ tenant: us, contactId: contact.id, channel: "SMS", to: contact.phone!, body: "come back", transactional: false });
    assert.equal(marketing.ok, false);
    assert.match(marketing.error ?? "", /consent/);
    const reply = await sendMessage({ tenant: us, contactId: contact.id, channel: "SMS", to: contact.phone!, body: "thanks for contacting us", transactional: true });
    assert.equal(reply.ok, true);
    await repository.setContactConsent(summit.id, contact.id, "sms", true, "test");
    const after = await sendMessage({ tenant: us, contactId: contact.id, channel: "SMS", to: contact.phone!, body: "come back", transactional: false });
    assert.equal(after.ok, true);
  });

  it("holds marketing during quiet hours as a scheduled release, not a dropped message", async () => {
    const quiet = withQuietHoursNow(summit, true);
    assert.equal(inQuietHours(quiet), true);
    const contact = await repository.upsertContact(summit.id, { firstName: "Night", lastName: null, email: "night@example.com", phone: null, company: null });
    const r = await sendMessage({ tenant: quiet, contactId: contact.id, channel: "EMAIL", to: contact.email!, body: "a win-back note", transactional: false });
    assert.equal(r.ok, false);
    assert.equal(r.held, true);
    const releaseAt = quietHoursEnd(quiet);
    assert.ok(releaseAt.getTime() > Date.now(), "release is in the future");
    const due = (await repository.listDueActions(new Date(releaseAt.getTime() + 60_000))).find((a) => a.typeKey === "messaging" && a.action === "release" && a.payload.to === contact.email);
    assert.ok(due, "a release action is queued for the end of quiet hours");
    // Running the release outside quiet hours sends it and logs honestly. The handler reads the stored tenant, so its
    // quiet hours are moved away from the current time for the run (the fixture's real window would hold it again at night).
    await repository.updateTenant(summit.id, { sla: withQuietHoursNow(summit, false).sla });
    try {
      await runScheduledAction({ ...due!, tenantId: summit.id });
    } finally {
      await repository.updateTenant(summit.id, { sla: summit.sla });
    }
    const runs = await repository.listAutomationRuns(summit.id, 50);
    assert.ok(runs.some((r) => r.typeKey === "messaging" && r.outcome === "SENT" && r.contactId === contact.id), "released message logged as sent");
  });

  it("moves a customer-facing send out of quiet hours", () => {
    const quiet = withQuietHoursNow(summit, true);
    const inAnHour = new Date(Date.now() + 3_600_000);
    const moved = clampOutOfQuietHours(quiet, inAnHour, null);
    assert.equal(inQuietHours(quiet, moved), false);
    const open = withQuietHoursNow(summit, false);
    assert.equal(clampOutOfQuietHours(open, inAnHour, null).getTime(), inAnHour.getTime(), "left alone when not in quiet hours");
  });

  it("caps automated sends per recipient per day", async () => {
    const contact = await repository.upsertContact(harbor.id, { firstName: "Cap", lastName: null, email: "cap@example.com", phone: null, company: null });
    let refused = 0;
    for (let i = 0; i < 6; i++) {
      const r = await sendMessage({ tenant: harbor, contactId: contact.id, channel: "EMAIL", to: contact.email!, body: `note ${i}`, transactional: true });
      if (!r.ok) refused++;
    }
    assert.ok(refused >= 2, `the fifth and sixth sends are held back (${refused} refused)`);
    // Internal alerts to the tenant's own people are not customer traffic: the sixth lead of the day still reaches them.
    let internalRefused = 0;
    for (let i = 0; i < 6; i++) {
      const r = await sendMessage({ tenant: harbor, contactId: null, channel: "EMAIL", to: "director@harbor.example", body: `lead alert ${i}`, subject: "New lead", transactional: true });
      if (!r.ok) internalRefused++;
    }
    assert.equal(internalRefused, 0, "lead alerts are never held back by the per-recipient cap");
  });

  it("texts a missed caller once a day however many times they ring", async () => {
    const contact = await repository.upsertContact(harbor.id, { firstName: "Ringer", lastName: null, email: null, phone: "+61400999888", company: null });
    assert.equal(await onMissedCall(harbor, contact), "sent");
    assert.equal(await onMissedCall(harbor, contact), "skipped");
    assert.equal(await onMissedCall(harbor, contact), "skipped");
  });
});

describe("scheduled actions are claimed, retried, then surfaced", () => {
  it("claims an action exactly once", async () => {
    const { record } = await repository.scheduleAction(harbor.id, { typeKey: "booking_lifecycle", action: "reminder", runAt: new Date(Date.now() - 1000), payload: {}, dedupeKey: "test:claim-once" });
    const now = new Date();
    assert.equal(await repository.claimAction(record.id, now, 600_000), true);
    assert.equal(await repository.claimAction(record.id, now, 600_000), false, "a second worker loses the race");
    // A stale lease is reclaimable.
    assert.equal(await repository.claimAction(record.id, new Date(now.getTime() + 700_000), 600_000), true);
    await repository.completeAction(record.id, "DONE");
    // The same key requested again (every tick re-requests the daily jobs) must not re-arm a finished action.
    const again = await repository.scheduleAction(harbor.id, { typeKey: "booking_lifecycle", action: "reminder", runAt: new Date(Date.now() - 1000), payload: {}, dedupeKey: "test:claim-once" });
    assert.equal(again.created, false);
    assert.equal(again.record.status, "DONE", "a DONE key stays done");
    assert.equal(await repository.claimAction(again.record.id, new Date(), 600_000), false, "and cannot be claimed again");
    // A cancelled key (a reminder cancelled by a reschedule) is re-armed.
    await repository.completeAction(record.id, "CANCELLED");
    const rearmed = await repository.scheduleAction(harbor.id, { typeKey: "booking_lifecycle", action: "reminder", runAt: new Date(Date.now() - 1000), payload: {}, dedupeKey: "test:claim-once" });
    assert.equal(rearmed.created, true);
    assert.equal(rearmed.record.status, "PENDING");
    await repository.completeAction(record.id, "DONE");
  });

  it("a step with no handler fails at once, with an exception an operator can see, instead of being retried", async () => {
    await repository.scheduleAction(harbor.id, { typeKey: "booking_lifecycle", action: "nonexistent_step", runAt: new Date(Date.now() - 1000), payload: { leadId: "lead_1" }, dedupeKey: "test:fails-once" });
    const now = new Date();
    await tick(now);
    const exceptions = await repository.listExceptions([harbor.id]);
    assert.ok(exceptions.some((e) => /nonexistent step/.test(e.reason) && /No handler/.test(e.reason)), "exception after the first failure");
    const runs = await repository.listAutomationRuns(harbor.id, 100);
    assert.ok(runs.some((r) => r.outcome === "FAILED" && /nonexistent step/.test(r.summary)));
    const stillDue = (await repository.listDueActions(new Date(now.getTime() + 86_400_000))).filter((a) => a.dedupeKey === "test:fails-once");
    assert.equal(stillDue.length, 0, "not retried: it could never succeed");
  });
});

describe("missed opportunities stick once a person closes them", () => {
  it("does not re-raise an item resolved recently, and closes its exception when recovered", async () => {
    const input = { type: "NOT_BOOKED" as const, leadId: "lead_1", contactId: "ct_1", subjectId: "lead_1:sticky", summary: "Sticky test", suggestedAction: "none" };
    const first = await raiseMissedOpportunity(harbor, input);
    assert.ok(first, "raised");
    const openEx = (await repository.listExceptions([harbor.id])).find((e) => e.missedOpportunityId === first!.id);
    assert.ok(openEx, "exception attached");
    await repository.resolveMissedOpportunity(harbor.id, first!.id, "RECOVERED", 100);
    const stillOpen = (await repository.listExceptions([harbor.id])).find((e) => e.id === openEx!.id);
    assert.equal(stillOpen, undefined, "exception closed with the item");
    const again = await raiseMissedOpportunity(harbor, input);
    assert.equal(again, null, "not re-raised inside the snooze window");
  });

  it("resolves by dedupe key when the flagged thing happens", async () => {
    const input = { type: "UNANSWERED_ENQUIRY" as const, leadId: "lead_1", contactId: "ct_1", subjectId: "lead_1:bykey", summary: "By key", suggestedAction: "none" };
    const raised = await raiseMissedOpportunity(harbor, input);
    assert.ok(raised);
    const resolved = await repository.resolveMissedOpportunityByKey(harbor.id, "UNANSWERED_ENQUIRY:lead_1:bykey", "RECOVERED");
    assert.equal(resolved?.status, "RECOVERED");
    assert.equal(resolved?.recoveredValueCents, raised!.estimatedValueCents);
  });
});

describe("credential encryption", () => {
  it("is versioned and bound to the row it was written for", () => {
    const enc = encryptSecret("tok_123", "int_1");
    assert.ok(enc.startsWith("v1."));
    assert.equal(decryptSecret(enc, "int_1"), "tok_123");
    assert.throws(() => decryptSecret(enc, "int_2"), "copied onto another row it must not decrypt");
  });
});
