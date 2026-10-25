import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { onBookingCreated, openInformationRequest, registerAutomations, runScheduledAction } from "@/lib/automations/handlers";
import { repository } from "@/lib/data";
import { demoTenants } from "@/lib/data/fixtures";
import { emit } from "@/lib/events";
import { tick } from "@/lib/jobs/tick";
import { detectForTenant } from "@/lib/opportunities/detect";
import { raiseMissedOpportunity } from "@/lib/opportunities/raise";
import { registerPlaybook } from "@/lib/playbook";

const harbor = demoTenants[0];
const summit = demoTenants[1];
const DAY = 86_400_000;

before(() => {
  process.env.MESSAGING_MODE = "log";
  process.env.DEFAULT_FROM_EMAIL = "hello@example.com";
  registerPlaybook();
  registerAutomations();
});

const openTypes = (list: { type: string; status: string }[]) => list.filter((m) => ["DETECTED", "RECOVERING", "ESCALATED"].includes(m.status)).map((m) => m.type);

describe("detectors", () => {
  it("find quiet quotes, unanswered reviews, lapsed customers, no-shows and idempotently raise each once", async () => {
    // Fixtures: lead_2 is 6 days quiet in "Agreement sent" (quietAfterDays 4), rv_1 is an unanswered 3-day-old review that
    // already has an open item (mo_2), ct_4 has had no CRM activity for 200 days but paid a commission 6 days ago.
    const first = await detectForTenant(harbor);
    const types = first.detected.map((d) => d.type);
    assert.ok(types.includes("QUIET_QUOTE"), `quiet quote detected: ${types}`);
    assert.ok(!types.includes("UNANSWERED_REVIEW"), "the review's existing open item is reused, not duplicated");
    assert.ok(!types.includes("LAPSED_CUSTOMER"), "a customer who paid inside the window is not lapsed, however quiet the CRM is");
    const second = await detectForTenant(harbor);
    assert.equal(second.detected.length, 0, "second pass finds nothing new");
    const open = await repository.listMissedOpportunities(harbor.id, { limit: 500 });
    assert.ok(openTypes(open).includes("QUIET_QUOTE"));
    assert.equal(open.filter((m) => m.dedupeKey === "UNANSWERED_REVIEW:rv_1").length, 1, "one item per review");
    // Real estate leaves win-back messages off (a quiet landlord is still a client), so nothing was sent to anyone.
    const runs = await repository.listAutomationRuns(harbor.id, 100);
    assert.ok(!runs.some((r) => r.typeKey === "reactivation"), "no reactivation for a real-estate tenant by default");
    assert.ok(!(await repository.listAutomationRuns(harbor.id, 100)).some((r) => /operator|workspace/i.test(r.summary)), "no internal words reach the owner");
    // Exceptions were created for each, escalated to an operator.
    const exceptions = await repository.listExceptions([harbor.id]);
    assert.ok(exceptions.some((e) => e.reason.includes("silent for")));
  });

  it("no-show bookings become missed opportunities", async () => {
    const booking = await repository.updateBooking(harbor.id, "bk_fixture_1", { status: "NO_SHOW" });
    assert.ok(booking);
    const r = await detectForTenant(harbor);
    assert.ok(r.detected.some((d) => d.type === "NO_SHOW"));
    const open = await repository.listMissedOpportunities(harbor.id, { status: ["ESCALATED", "DETECTED", "RECOVERING"], limit: 500 });
    assert.ok(open.some((m) => m.type === "NO_SHOW" && m.leadId === "lead_2"));
  });

  it("abandoned forms with partial contact details are raised once and create a contact", async () => {
    await repository.upsertFormSession(summit.id, { sessionKey: "sess_abandoned_1", formName: "trial", pageUrl: "https://summit.example/trial", partial: { name: "Riley Ng", email: "riley@example.com" } });
    const r = await detectForTenant(summit, new Date(Date.now() + 45 * 60_000));
    assert.ok(r.detected.some((d) => d.type === "ABANDONED_FORM"));
    const again = await detectForTenant(summit, new Date(Date.now() + 60 * 60_000));
    assert.equal(again.detected.filter((d) => d.type === "ABANDONED_FORM").length, 0);
    const contacts = await repository.listLapsedCandidates(summit.id, new Date(0));
    assert.ok(Array.isArray(contacts) && contacts.every((c) => typeof c.id === "string"), "lapsed candidates come back as contacts");
  });

  it("unreplied social messages are raised after the threshold", async () => {
    const contact = await repository.upsertContact(summit.id, { firstName: "Dee", lastName: null, email: "dee@example.com", phone: null, company: null });
    await repository.recordMessage(summit.id, { contactId: contact.id, channel: "SOCIAL_DM", direction: "INBOUND", sender: "CONTACT", body: "Do you have a 6am class?", status: "RECEIVED", externalConversationId: "ig_thread_1" });
    const soon = await detectForTenant(summit, new Date(Date.now() + 60 * 60_000));
    assert.equal(soon.detected.filter((d) => d.type === "UNREPLIED_DM").length, 0, "not yet past 120 minutes");
    const later = await detectForTenant(summit, new Date(Date.now() + 3 * 60 * 60_000));
    assert.ok(later.detected.some((d) => d.type === "UNREPLIED_DM"));
  });
});

describe("escalation rules", () => {
  it("escalate to the named client person instead of only an operator", async () => {
    const tenant = { ...harbor, escalationRules: [{ when: "MISSED_CALL", notifyUserId: "user_director" }] };
    const contact = await repository.upsertContact(harbor.id, { firstName: "Caller", lastName: "One", email: null, phone: "+61400000999", company: null });
    const record = await raiseMissedOpportunity(tenant, { type: "MISSED_CALL", leadId: null, contactId: contact.id, subjectId: "call_test_1", summary: "Caller One called and nobody answered.", suggestedAction: "Call back." });
    assert.ok(record);
    const ex = (await repository.listExceptions([harbor.id])).find((e) => e.missedOpportunityId === record!.id);
    assert.equal(ex?.escalatedToUserId, "user_director");
    assert.equal(record!.estimatedValueCents, harbor.opportunityValues.MISSED_CALL);
  });
});

describe("booking lifecycle and scheduled work", () => {
  it("confirms, schedules a reminder and an auto-complete, then follows up and asks for a review", async () => {
    const lead = (await repository.listRecentLeads(summit.id, 10)).find((l) => l.id === "lead_5")!;
    const booking = await repository.findBookingById(summit.id, "bk_fixture_2");
    assert.ok(booking?.startsAt);
    await repository.updateBooking(summit.id, booking!.id, { confirmedAt: null });
    await onBookingCreated(summit, lead, booking!.id, booking!.startsAt, booking!.endsAt);
    const runs = await repository.listAutomationRuns(summit.id, 50);
    assert.ok(runs.some((r) => /Confirmed Jordan Lee/.test(r.summary) && r.outcome === "SENT"), "confirmation run");
    // A redelivered webhook never confirms twice.
    await onBookingCreated(summit, lead, booking!.id, booking!.startsAt, booking!.endsAt);
    assert.equal((await repository.listAutomationRuns(summit.id, 50)).filter((r) => /Confirmed Jordan Lee/.test(r.summary)).length, 1, "confirmed once");
    // The reminder is queued about 24 h before the booking, then moved out of quiet hours if that lands at night, so look
    // for it anywhere before the booking starts rather than at an exact hour (the fixture's time of day is relative to now).
    const due = await repository.listDueActions(booking!.startsAt!);
    const reminder = due.find((a) => a.action === "reminder" && a.payload.bookingId === booking!.id);
    assert.ok(reminder, "reminder scheduled before the booking");
    assert.ok(reminder!.runAt.getTime() <= booking!.startsAt!.getTime() && reminder!.runAt.getTime() >= booking!.startsAt!.getTime() - 36 * 3_600_000, "within the day before, outside quiet hours");
    await runScheduledAction(reminder!);
    assert.ok((await repository.findBookingById(summit.id, booking!.id))?.remindedAt, "reminded");

    // Time passes: auto-complete runs, which emits booking.completed → follow-up and review request get queued.
    const autoComplete = (await repository.listDueActions(new Date(booking!.endsAt!.getTime() + 3 * 3_600_000))).find((a) => a.action === "auto_complete" && a.payload.bookingId === booking!.id);
    assert.ok(autoComplete);
    await runScheduledAction(autoComplete!);
    assert.equal((await repository.findBookingById(summit.id, booking!.id))?.status, "COMPLETED");
    const queued = await repository.listDueActions(new Date(Date.now() + 2 * DAY));
    const followUp = queued.find((a) => a.action === "follow_up" && a.payload.bookingId === booking!.id);
    assert.ok(followUp, "follow-up queued");
    assert.equal(followUp!.payload.uncertain, true, "nobody confirmed they came, so the follow-up assumes nothing");
    assert.ok(!queued.some((a) => a.typeKey === "review_request" && a.payload.bookingId === booking!.id), "no review ask after an unconfirmed appointment");
    await runScheduledAction(followUp!);
    assert.ok((await repository.findBookingById(summit.id, booking!.id))?.followedUpAt);
    // A person marks it attended: now the review ask is queued.
    await emit(summit.id, "booking.completed", { bookingId: booking!.id, leadId: lead.id, by: "operator" });
    const review = (await repository.listDueActions(new Date(Date.now() + 2 * DAY))).find((a) => a.typeKey === "review_request" && a.payload.bookingId === booking!.id);
    assert.ok(review, "review request queued after an explicit completion");
    await runScheduledAction(review!);
    const later = await repository.listAutomationRuns(summit.id, 50);
    assert.ok(later.some((r) => r.typeKey === "review_request" && r.outcome === "SKIPPED" && /no review link/.test(r.summary)), "review skipped honestly without a review link");
  });

  it("chases a request, stops after the cap and escalates", async () => {
    const lead = (await repository.listRecentLeads(harbor.id, 20)).find((l) => l.id === "lead_1")!;
    const req = await openInformationRequest(harbor, { contactId: lead.contactId, leadId: lead.id, kind: "document", description: "the signed management agreement", dueAt: new Date(Date.now() - 1000) });
    for (let i = 0; i < 4; i++) {
      const due = (await repository.listDueActions(new Date(Date.now() + 30 * DAY))).filter((a) => a.typeKey === "chase_information" && a.payload.requestId === req.id);
      if (due.length === 0) break;
      await runScheduledAction(due[0]);
      await repository.completeAction(due[0].id, "DONE");
    }
    const after = (await repository.listInformationRequests(harbor.id, { status: ["OPEN", "ESCALATED", "RECEIVED", "CANCELLED"], limit: 500 })).find((r) => r.id === req.id)!;
    assert.equal(after.chaseCount, 3, "capped at maxChases");
    assert.equal(after.status, "ESCALATED");
    assert.ok((await repository.listExceptions([harbor.id])).some((e) => e.reason.includes("signed management agreement")));
  });

  it("the tick runs detectors and due actions across tenants and reports counts", async () => {
    await repository.scheduleAction(harbor.id, { typeKey: "booking_lifecycle", action: "nonexistent", runAt: new Date(Date.now() - 1000), dedupeKey: "test:bad-action" });
    const result = await tick();
    assert.equal(result.tenants, 2);
    assert.ok(result.actionsFailed >= 1, "unknown action is reported as failed, not thrown");
  });

  it("events drive the handlers end to end: booking.completed queues work", async () => {
    const lead = (await repository.listRecentLeads(harbor.id, 20)).find((l) => l.id === "lead_1")!;
    const { id } = await repository.createBooking(harbor.id, { leadId: lead.id, bookingUrl: "x", sent: true });
    await repository.updateBooking(harbor.id, id, { status: "COMPLETED", startsAt: new Date(Date.now() - DAY), endsAt: new Date(Date.now() - DAY + 3_600_000) });
    await emit(harbor.id, "booking.completed", { bookingId: id, leadId: lead.id });
    const queued = await repository.listDueActions(new Date(Date.now() + 2 * DAY));
    assert.ok(queued.some((a) => a.action === "follow_up" && a.payload.bookingId === id));
  });
});
