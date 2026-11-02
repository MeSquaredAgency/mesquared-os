import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { registerAutomations } from "@/lib/automations/handlers";
import { repository } from "@/lib/data";
import { demoTenants } from "@/lib/data/fixtures";
import { sendWeeklyDigest, weekBounds } from "@/lib/digest/weekly";
import { emit } from "@/lib/events";
import { tick } from "@/lib/jobs/tick";
import { detectForTenant } from "@/lib/opportunities/detect";
import { templates } from "@/lib/messaging";
import { assignNewLead, registerPlaybook, runGreenLeadPlaybook } from "@/lib/playbook";

/**
 * Third upgrade batch: round-robin lead assignment, the Monday summary email,
 * and the safety net under the inline playbook.
 */

const harbor = demoTenants[0];
const MINUTE = 60_000;

const greenLead = {
  contactId: null as string | null,
  source: "WEB_FORM" as const,
  firstName: "Batch",
  lastName: "Three",
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

describe("round-robin assignment", () => {
  it("hands new leads to whoever has had the fewest this week, and alerts only them", async () => {
    const recipients = await repository.listAlertRecipients(harbor.id);
    assert.ok(recipients.length >= 2, "the demo workspace has at least two people with lead alerts");
    const contact = await repository.upsertContact(harbor.id, { firstName: "Round", lastName: "Robin", email: "round-robin@example.com", phone: null, company: null });
    const assigned: string[] = [];
    for (let i = 0; i < recipients.length * 2; i++) {
      const { lead } = await repository.createLead(harbor.id, { ...greenLead, contactId: contact.id, email: contact.email, externalId: `b3:rr:${i}` });
      const result = await assignNewLead(harbor, lead, { assign: "round_robin" }, recipients);
      assert.ok(result.lead.assigneeId, "assigned");
      assert.deepEqual(result.alert.map((r) => r.userId), [result.lead.assigneeId], "only the assignee is alerted");
      assigned.push(result.lead.assigneeId!);
    }
    // Balance is judged on the week's total load, not just this loop: someone who was already busy gets fewer now.
    const weekly = await repository.countLeadsByAssignee(harbor.id, new Date(Date.now() - 7 * 86_400_000));
    const values = recipients.map((r) => weekly[r.userId] ?? 0);
    assert.ok(assigned.every((id) => recipients.some((r) => r.userId === id)), "only alert holders are chosen");
    assert.ok(Math.max(...values) - Math.min(...values) <= 1, `evenly spread this week: ${JSON.stringify(weekly)}`);
    const stored = await repository.findLeadById(harbor.id, (await repository.listRecentLeads(harbor.id, 5)).find((l) => l.externalId === "b3:rr:0")!.id);
    assert.ok(stored?.assigneeId, "persisted on the lead");
  });

  it("leaves things as they were when assignment is off or the lead already has an owner", async () => {
    const recipients = await repository.listAlertRecipients(harbor.id);
    const contact = await repository.upsertContact(harbor.id, { firstName: "Already", lastName: "Owned", email: "already-owned@example.com", phone: null, company: null });
    const { lead } = await repository.createLead(harbor.id, { ...greenLead, contactId: contact.id, email: contact.email, externalId: "b3:rr:off" });
    const off = await assignNewLead(harbor, lead, {}, recipients);
    assert.equal(off.lead.assigneeId, null);
    assert.equal(off.alert.length, recipients.length, "everyone is told");
    await repository.assignLead(harbor.id, lead.id, recipients[1].userId);
    const owned = await assignNewLead(harbor, { ...lead, assigneeId: recipients[1].userId }, { assign: "round_robin" }, recipients);
    assert.deepEqual(owned.alert.map((r) => r.userId), [recipients[1].userId], "the existing owner is the one alerted");
  });
});

describe("the Monday email", () => {
  it("covers the seven days before this week's Monday, on the tenant's calendar", () => {
    // Wednesday 4 November 2026, 09:00 in Adelaide.
    const { start, end, label } = weekBounds("Australia/Adelaide", "en-AU", new Date("2026-11-03T22:30:00Z"));
    assert.equal(new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Adelaide" }).format(end), "2026-11-02", "this Monday");
    assert.equal(new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Adelaide" }).format(start), "2026-10-26", "last Monday");
    assert.match(label, /26 October – 1 November/);
    // Monday itself still points at the week just gone.
    const monday = weekBounds("Australia/Adelaide", "en-AU", new Date("2026-11-01T22:30:00Z"));
    assert.equal(new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Adelaide" }).format(monday.end), "2026-11-02");
  });

  it("writes one plain email per owner or manager and logs it once", async () => {
    const result = await sendWeeklyDigest(harbor, new Date());
    const run = (await repository.listAutomationRuns(harbor.id, 20)).find((r) => r.typeKey === "weekly_digest");
    assert.ok(run, "the digest leaves a line in the activity log");
    if (result.sent > 0) assert.match(run!.summary, /Sent the weekly summary/);
    else assert.match(run!.summary, /could not be sent/);
  });
});

describe("a lead who texts back is heard", () => {
  it("tells the assigned person with the words, and the inbox watch raises it if nobody replies", async () => {
    const recipients = await repository.listAlertRecipients(harbor.id);
    const contact = await repository.upsertContact(harbor.id, { firstName: "Texts", lastName: "Back", email: null, phone: "+61400123123", company: null });
    const { lead } = await repository.createLead(harbor.id, { ...greenLead, contactId: contact.id, phone: contact.phone, externalId: "b3:reply:1" });
    await repository.assignLead(harbor.id, lead.id, recipients[0].userId);
    const { conversationId, messageId } = await repository.recordMessage(harbor.id, { contactId: contact.id, channel: "SMS", direction: "INBOUND", sender: "CONTACT", body: "Yes please, Tuesday works for me", status: "RECEIVED" });
    await emit(harbor.id, "message.received", { contactId: contact.id, channel: "SMS", conversationId, messageId });

    const run = (await repository.listAutomationRuns(harbor.id, 30)).find((r) => r.contactId === contact.id && /replied by SMS/.test(r.summary));
    assert.ok(run, "the reply is in the activity log");
    assert.equal(run!.leadId, lead.id, "tied to their live lead");
    assert.match(run!.summary, new RegExp(`told ${recipients[0].name ?? recipients[0].email}`), "only the assigned person was told");

    // Three hours later with no answer from us, the inbox watch flags it like an unanswered DM.
    const convo = await repository.findConversationById(harbor.id, conversationId);
    assert.ok(convo?.awaitingReply, "the thread is waiting on us");
    const later = new Date(Date.now() + 3 * 60 * MINUTE);
    const result = await detectForTenant(harbor, later);
    const flagged = result.detected.find((d) => d.subjectId === conversationId);
    assert.equal(flagged?.type, "UNREPLIED_DM");
    const item = (await repository.listMissedOpportunities(harbor.id, { limit: 50 })).find((m) => m.dedupeKey === `UNREPLIED_DM:${conversationId}`);
    assert.match(item?.summary ?? "", /sent a text/);
  });
});

describe("the phone buzzes when a lead arrives", () => {
  it("writes a short text with who, what, where and the number", () => {
    const text = templates.leadAlertSms({ tenant: harbor, leadName: "Margaret Ellis", topic: "appraisal", area: "Norwood", phone: "+61400111222", acknowledged: "SENT" });
    assert.equal(text, "Harbor Realty Group: Margaret Ellis wants an appraisal in Norwood. +61400111222. We've replied with a booking link; a call now wins it.");
    assert.ok(text.length <= 160, `fits one segment: ${text.length}`);
    const callFirst = templates.leadAlertSms({ tenant: harbor, leadName: "Margaret Ellis", topic: "appraisal", area: "Norwood", phone: "+61400111222", acknowledged: "SENT", callFirst: true });
    assert.equal(callFirst, "Harbor Realty Group: Margaret Ellis wants an appraisal in Norwood. +61400111222. We've told them to expect your call. Please call now.");
    assert.ok(callFirst.length <= 160, `fits one segment: ${callFirst.length}`);
    assert.match(templates.leadAlertSms({ tenant: harbor, leadName: "Sam", topic: null, area: null, phone: null, acknowledged: "NONE" }), /Sam just enquired\. No reply has gone out yet; please call them\./);
    assert.match(templates.leadAlertSms({ tenant: harbor, leadName: "Sam", topic: "sale", area: null, phone: null, acknowledged: "HELD" }), /wants a sale\. Our reply goes out in the morning/);
    assert.doesNotMatch(templates.leadAlertSms({ tenant: harbor, leadName: "Visit http://evil.example now", topic: null, area: null, phone: null, acknowledged: "SENT" }), /http/, "links in a stranger's name are stripped");
  });

  it("texts the assigned person as well as emailing them", async () => {
    process.env.DEFAULT_FROM_NUMBER ??= "+61400000000";
    const recipients = await repository.listAlertRecipients(harbor.id);
    const person = recipients[0];
    const roles = (await repository.getTenantConfig(harbor.id)).roles;
    const people = await repository.listTenantPeople(harbor.id);
    const me = people.find((p) => p.userId === person.userId)!;
    await repository.upsertMembership(harbor.id, person.userId, me.roleId ?? roles[0].id, { phone: "+61400555000" });
    try {
      const contact = await repository.upsertContact(harbor.id, { firstName: "Buzz", lastName: "Test", email: "buzz@example.com", phone: "+61400666000", company: null });
      const { lead } = await repository.createLead(harbor.id, { ...greenLead, contactId: contact.id, email: contact.email, phone: contact.phone, externalId: "b3:buzz:1" });
      await repository.assignLead(harbor.id, lead.id, person.userId);
      await runGreenLeadPlaybook(harbor, { ...lead, assigneeId: person.userId });
      const told = (await repository.listAutomationRuns(harbor.id, 30)).find((r) => r.leadId === lead.id && /^Told /.test(r.summary));
      assert.ok(told, "the alert is logged");
      assert.match(told!.summary, /by text and email/);
      const texts = await repository.countOutboundMessages(harbor.id, { since: new Date(Date.now() - 60_000), to: "+61400555000" });
      assert.ok(texts >= 1, "a text went to the assigned person's phone");
    } finally {
      await repository.upsertMembership(harbor.id, person.userId, me.roleId ?? roles[0].id, { phone: null });
    }
  });
});

describe("a lead who asks to be called back", () => {
  it("is routed to the person who should make the call, with what they said", async () => {
    const recipients = await repository.listAlertRecipients(harbor.id);
    const contact = await repository.upsertContact(harbor.id, { firstName: "Call", lastName: "Me", email: "call-me@example.com", phone: "+61400321321", company: null });
    const { lead } = await repository.createLead(harbor.id, { ...greenLead, contactId: contact.id, email: contact.email, phone: contact.phone, externalId: "b3:callback:1" });
    await repository.assignLead(harbor.id, lead.id, recipients[1].userId);
    await emit(harbor.id, "booking.callback_requested", { leadId: lead.id, when: "tomorrow morning" });
    const run = (await repository.listAutomationRuns(harbor.id, 30)).find((r) => r.leadId === lead.id && /wants a call back/.test(r.summary));
    assert.ok(run, "logged");
    assert.match(run!.summary, new RegExp(`Told ${recipients[1].name ?? recipients[1].email}`), "the assigned person, not everyone");
    assert.match(run!.summary, /tomorrow morning/);
    const sms = templates.callbackRequestedSms({ tenant: harbor, leadName: "Call Me", when: "tomorrow morning", phone: "+61400321321" });
    assert.match(sms, /Call Me asked for a call back: "tomorrow morning"\. \+61400321321\./);
  });
});

describe("the safety net under the playbook", () => {
  it("runs the playbook for a green lead that never got one, and never twice", async () => {
    const contact = await repository.upsertContact(harbor.id, { firstName: "Safety", lastName: "Net", email: "safety-net@example.com", phone: null, company: null });
    const { lead } = await repository.createLead(harbor.id, { ...greenLead, contactId: contact.id, email: contact.email, externalId: "b3:ensure:1" });
    assert.equal(await repository.countAutomationRuns(harbor.id, { typeKey: "enquiry_auto_reply", leadId: lead.id }), 0, "nothing ran for it");
    await repository.scheduleAction(harbor.id, { typeKey: "playbook", action: "ensure", runAt: new Date(Date.now() - MINUTE), payload: { leadId: lead.id, contactId: contact.id }, dedupeKey: `playbook:ensure:${lead.id}` });
    await tick(new Date());
    const after = await repository.countAutomationRuns(harbor.id, { typeKey: "enquiry_auto_reply", leadId: lead.id });
    assert.ok(after >= 1, "the net ran the playbook");

    // Queued again (as a retry would): the lead already had its turn, so nothing more goes out.
    await repository.scheduleAction(harbor.id, { typeKey: "playbook", action: "ensure", runAt: new Date(Date.now() - MINUTE), payload: { leadId: lead.id, contactId: contact.id }, dedupeKey: `playbook:ensure:${lead.id}:again` });
    await tick(new Date());
    assert.equal(await repository.countAutomationRuns(harbor.id, { typeKey: "enquiry_auto_reply", leadId: lead.id }), after, "no second acknowledgement");
  });
});
