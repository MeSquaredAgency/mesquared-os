import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { runScheduledAction } from "@/lib/automations/handlers";
import { repository } from "@/lib/data";
import { demoTenants } from "@/lib/data/fixtures";
import { parseEnquiryEmail } from "@/lib/intake/channels/email-parsers";
import { mapMetaFieldData, parseMetaLeadgenEvents, verifyMetaSignature } from "@/lib/intake/channels/meta";
import { processIntake } from "@/lib/intake/process";
import { intakeSchema } from "@/lib/intake/schema";
import { chooseChannel, inQuietHours, regionRule, templates } from "@/lib/messaging";
import { chaseUncalledLead } from "@/lib/opportunities/call-first";
import { detectForTenant } from "@/lib/opportunities/detect";
import { scoreLead } from "@/lib/qualify/rules";
import { bookingLinkFor } from "@/lib/scheduling/calcom";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { createHmac } from "node:crypto";

const harbor = demoTenants[0];

before(() => {
  process.env.MESSAGING_MODE = "log";
  process.env.DEFAULT_FROM_EMAIL = "hello@example.com";
});

describe("messaging policy", () => {
  it("picks SMS for AU phones, email otherwise, nothing without contact details", () => {
    assert.equal(chooseChannel({ region: "AU" }, { phone: "+61400000000", email: null }), "SMS");
    assert.equal(chooseChannel({ region: "AU" }, { phone: null, email: "a@b.co" }), "EMAIL");
    assert.equal(chooseChannel({ region: "KH" }, { phone: "+85512345678", email: null }), "WHATSAPP");
    assert.equal(chooseChannel({ region: "AU" }, { phone: null, email: null }), null);
    assert.deepEqual(regionRule("US").requiresConsentFor, ["SMS", "WHATSAPP"]);
  });

  it("knows quiet hours in the tenant timezone", () => {
    const t = { timezone: "Australia/Adelaide", region: "AU", sla: { firstResponseMinutes: 5, bookingWindowHours: 72, quietHours: { start: 20, end: 8 } } };
    // 2026-01-15T12:30Z is 23:00 in Adelaide (UTC+10:30 in January).
    assert.equal(inQuietHours(t, new Date("2026-01-15T12:30:00Z")), true);
    // 2026-01-15T02:30Z is 13:00 in Adelaide.
    assert.equal(inQuietHours(t, new Date("2026-01-15T02:30:00Z")), false);
  });

  it("templates identify as automated and come from the tenant", () => {
    const sms = templates.acknowledgementSms({ tenant: harbor, firstName: "Margaret", bookingUrl: "https://x/y", topic: "an appraisal" });
    assert.match(sms, /Hi Margaret/);
    assert.match(sms, /automated reply from Harbor Realty Group/);
    assert.ok(!/[—–]/.test(sms), "no em dash: keeps the SMS in the cheap GSM-7 alphabet");
    assert.match(sms, /https:\/\/x\/y/);
    const mail = templates.acknowledgementEmail({ tenant: harbor, firstName: null, bookingUrl: "https://x/y", topic: null });
    assert.match(mail.subject, /Harbor Realty Group/);
    assert.match(mail.body, /automated (reply|message)/);
    assert.doesNotMatch(sms + mail.body, /MeSquared|Me²/);
  });
});

describe("booking links", () => {
  it("prefills Cal.com when connected and falls back to the platform page otherwise", async () => {
    const link = await bookingLinkFor(harbor, { id: "lead_x", firstName: "Peter", lastName: "Nguyen", email: "p@example.com", phone: "+61400333444" });
    assert.match(link, /^https:\/\/cal\.com\/harbor-realty\/appraisal\?/);
    assert.match(link, /name=Peter\+Nguyen/);
    assert.match(link, /metadata%5BleadId%5D=lead_x/);
    const summit = demoTenants[1]; // Cal.com disconnected in fixtures
    const fallback = await bookingLinkFor(summit, { id: "lead_y", firstName: null, lastName: null, email: null, phone: null });
    assert.match(fallback, /\/book\/summit-fitness\?lead=lead_y$/);
  });
});

describe("green-lead playbook (log provider)", () => {
  it("acknowledges, records the message on a conversation, marks responded and booking sent, alerts recipients", async () => {
    const body = intakeSchema.parse({ source: "WEB_FORM", externalId: "pb_1", name: "Olive Tan", email: "olive@example.com", phone: "+61 400 999 111", message: "I own a unit in Adelaide and want an appraisal to sell." });
    const result = await processIntake(harbor, body, {});
    assert.equal(result.outcome, "created");
    if (result.outcome !== "created") return;
    assert.equal(result.qualification.ticketType, "GREEN");
    const lead = await repository.findLeadById(harbor.id, result.lead.id);
    assert.ok(lead?.firstResponseAt, "first response recorded");
    assert.equal(lead?.status, "BOOKING_SENT");
    const runs = (await repository.listAutomationRuns(harbor.id, 20)).filter((r) => r.leadId === lead!.id);
    assert.ok(runs.some((r) => r.outcome === "SENT" && /Acknowledged Olive Tan by SMS/.test(r.summary)), "acknowledgement run");
    assert.ok(runs.some((r) => /Told .* about Olive Tan/.test(r.summary)), "alert run");
    const events = await repository.listEvents(harbor.id, 50);
    assert.ok(events.some((e) => e.type === "message.sent" && e.payload.leadId === lead!.id));
    assert.ok(events.some((e) => e.type === "alert.sent" && e.payload.leadId === lead!.id));
  });

  it("falls back to email when the provider refuses the text, and says so", async () => {
    process.env.MESSAGING_LOG_FAIL = "SMS";
    try {
      const body = intakeSchema.parse({ source: "WEB_FORM", externalId: "pb_sms_refused", name: "Ravi Mehta", email: "ravi@example.com", phone: "+61 400 999 112", message: "I own a unit in Adelaide and want an appraisal to sell." });
      const result = await processIntake(harbor, body, {});
      assert.equal(result.outcome, "created");
      if (result.outcome !== "created") return;
      const lead = await repository.findLeadById(harbor.id, result.lead.id);
      assert.equal(lead?.status, "BOOKING_SENT", "the lead still got the booking link");
      const runs = (await repository.listAutomationRuns(harbor.id, 20)).filter((r) => r.leadId === lead!.id);
      const ack = runs.find((r) => /Acknowledged Ravi Mehta by email/.test(r.summary));
      assert.ok(ack, `acknowledged by email: ${runs.map((r) => r.summary).join(" | ")}`);
      assert.equal(ack!.outcome, "SENT");
      assert.match(ack!.summary, /the SMS couldn't be sent: Simulated SMS provider failure/);
    } finally {
      delete process.env.MESSAGING_LOG_FAIL;
    }
  });

  it("falls back to email when the preferred channel has no sender configured", async () => {
    // Summit has no TWILIO integration and DEFAULT_FROM_NUMBER is unset, so SMS cannot be sent; the lead also gave an email.
    const summit = demoTenants[1];
    const body = intakeSchema.parse({ source: "WEB_FORM", externalId: "pb_fallback_1", name: "Fallback Lead", email: "fallback@example.com", phone: "+61400222444", message: "Keen to join and start personal training, can I book a trial?" });
    const result = await processIntake(summit, body, {});
    assert.equal(result.outcome, "created");
    if (result.outcome !== "created") return;
    assert.equal(result.qualification.ticketType, "GREEN");
    const lead = await repository.findLeadById(summit.id, result.lead.id);
    assert.ok(lead?.firstResponseAt, "acknowledged via the fallback channel");
    const runs = (await repository.listAutomationRuns(summit.id, 30)).filter((r) => r.leadId === lead!.id);
    assert.ok(runs.some((r) => /Acknowledged Fallback Lead by email/.test(r.summary)), "email acknowledgement run");
    assert.ok(runs.some((r) => /SMS isn.t set up/.test(r.summary)), "honest note about SMS");
  });

  it("call-first: promises a call, leaves the response clock running, and chases the team until someone calls", async () => {
    const original = harbor.sla;
    const tenant = (await repository.updateTenant(harbor.id, { sla: { ...harbor.sla, responseMode: "call_first" } }))!;
    try {
      const body = intakeSchema.parse({ source: "WEB_FORM", externalId: "pb_call_first", name: "Nora Quinn", email: "nora@example.com", phone: "+61 400 999 113", message: "I own a unit in Adelaide and want an appraisal to sell." });
      const result = await processIntake(tenant, body, {});
      assert.equal(result.outcome, "created");
      if (result.outcome !== "created") return;
      const lead = await repository.findLeadById(harbor.id, result.lead.id);
      assert.equal(lead?.firstResponseAt, null, "the automated reply is not the response");
      assert.equal(lead?.status, "QUALIFIED", "the lead stays in Needs you until a person calls");
      const runs = (await repository.listAutomationRuns(harbor.id, 30)).filter((r) => r.leadId === lead!.id);
      assert.ok(runs.some((r) => r.outcome === "SENT" && /Acknowledged Nora Quinn by SMS and promised a call/.test(r.summary)), `promised a call: ${runs.map((r) => r.summary).join(" | ")}`);
      assert.ok(runs.some((r) => /Told .* about Nora Quinn/.test(r.summary)), "the team was alerted");

      // Six minutes on and nobody has called: the enquiry is raised and the team is reminded on their phones.
      const later = new Date(Date.now() + 6 * 60_000);
      const detected = await detectForTenant(tenant, later);
      assert.ok(detected.detected.some((d) => d.type === "UNANSWERED_ENQUIRY" && d.subjectId === lead!.id), "raised as unanswered");
      const afterDetect = (await repository.listAutomationRuns(harbor.id, 50)).filter((r) => r.leadId === lead!.id);
      assert.ok(afterDetect.some((r) => r.typeKey === "sla_watch" && r.outcome === "SENT" && /Reminded .* to call Nora Quinn: \d+ min and nobody has yet/.test(r.summary)), `reminded: ${afterDetect.map((r) => r.summary).join(" | ")}`);
      const chase = (await repository.listDueActions(new Date(later.getTime() + 11 * 60_000), 500)).find((a) => a.dedupeKey === `sla_watch:chase_call:${lead!.id}`);
      assert.ok(chase, "a second chase is queued");

      // Still nobody: everyone who holds lead alerts is chased.
      await runScheduledAction(chase!);
      const afterChase = (await repository.listAutomationRuns(harbor.id, 50)).filter((r) => r.leadId === lead!.id);
      assert.ok(afterChase.some((r) => /Chased 2 people to call Nora Quinn/.test(r.summary)), `chased everyone: ${afterChase.map((r) => r.summary).join(" | ")}`);

      // Once a person has called, a queued chase does nothing.
      await repository.settleLeadSla(harbor.id, lead!.id, new Date());
      assert.equal(await chaseUncalledLead(tenant, lead!, { again: true }), "settled");
    } finally {
      await repository.updateTenant(harbor.id, { sla: original });
    }
  });

  it("call-first copy promises a call from the team, names nobody, and sends no link by text", () => {
    const sms = templates.acknowledgementSms({ tenant: harbor, firstName: "Margaret", bookingUrl: "https://x/y", topic: "an appraisal", area: "Norwood", signedBy: "Dana", callFirst: true });
    assert.equal(sms, "Hi Margaret, thanks for contacting Harbor Realty Group about an appraisal in Norwood. One of our team will call you shortly. If now isn't a good time, reply with a better one. This is an automated reply from Dana at Harbor Realty Group.");
    assert.doesNotMatch(sms, /https:\/\/x\/y/, "no link to tap: the call is the next step");
    const mail = templates.acknowledgementEmail({ tenant: harbor, firstName: null, bookingUrl: "https://x/y", topic: null, callFirst: true });
    assert.match(mail.body, /one of our team will call you shortly/);
    assert.match(mail.body, /reply to this email with a better one/);
    assert.deepEqual(mail.cta, { label: "Choose a time", url: "https://x/y" });
    const alert = templates.leadAlertEmail({ tenant: harbor, leadName: "Margaret Ellis", summary: "Appraisal please", score: 80, reason: "owner", phone: "+61400111222", email: null, portalUrl: "https://os/app", acknowledged: "SENT", callFirst: true });
    assert.match(alert.body, /told one of your team will call them shortly, so please call them now/);
    const chase = templates.callOverdueSms({ tenant: harbor, leadName: "Margaret Ellis", minutes: 7, phone: "+61400111222" });
    assert.equal(chase, "Harbor Realty Group: nobody has called Margaret Ellis yet (7 min). +61400111222. Please call now.");
    assert.ok(chase.length <= 160);
    assert.match(templates.callOverdueSms({ tenant: harbor, leadName: "Margaret Ellis", minutes: 17, phone: null, again: true }), /still nobody has called Margaret Ellis yet \(17 min\)\. They were promised a call; please call now\./);
  });

  it("alert recipients are the members holding RECEIVE_LEAD_ALERTS", async () => {
    const recipients = await repository.listAlertRecipients(harbor.id);
    assert.deepEqual(recipients.map((r) => r.email).sort(), ["director@harbor.example", "pm@harbor.example"]);
  });

  it("booking webhook effect: markLeadBooked advances the stage and resolves NOT_BOOKED", async () => {
    const config = await repository.getTenantConfig(harbor.id);
    const pipeline = config.pipelines.find((p) => p.isDefault)!;
    const lead = await repository.markLeadBooked(harbor.id, "lead_4", new Date());
    assert.equal(lead?.status, "BOOKED");
    assert.equal(lead?.stageId, pipeline.stages.find((s) => s.advanceOn === "BOOKING_CREATED")!.id);
  });
});

describe("qualifier tenant criteria", () => {
  it("penalises missing phone when required, rewards service area, downgrades auto-handled topics", () => {
    const rules = harbor.qualificationRules;
    const noPhone = scoreLead({ source: "WEB_FORM", email: "a@b.co", message: "I want an appraisal for my house in Adelaide", attributes: {} }, rules);
    const withPhone = scoreLead({ source: "WEB_FORM", email: "a@b.co", phone: "+61400000000", message: "I want an appraisal for my house in Adelaide", attributes: {} }, rules);
    assert.ok(withPhone.intentScore > noPhone.intentScore + 15);
    assert.ok(withPhone.signals.some((s) => s.includes("in service area: adelaide")));
    const renter = scoreLead({ source: "PORTAL_EMAIL", email: "r@b.co", message: "Is the rental still available? I'd like an inspection time.", attributes: {} }, rules);
    assert.equal(renter.ticketType, "RED");
    assert.ok(renter.signals.some((s) => s.includes("handled automatically")));
  });
});

describe("email parsers", () => {
  it("parses a realestate.com.au style enquiry", () => {
    const parsed = parseEnquiryEmail({
      from: "enquiries@realestate.com.au",
      to: "intake+harbor-realty@inbound.mesquared.example",
      subject: "New enquiry about 12 Marine Parade, Glenelg",
      text: ["You have a new enquiry.", "Name: Lucy Tran", "Email: lucy.t@example.com", "Phone: 0400 333 444", "Property: 12 Marine Parade, Glenelg", "Message: Is this still available? When is the next inspection?", "", "Sent by realestate.com.au"].join("\n"),
      messageId: "<abc@rea>",
    });
    assert.equal(parsed.provider, "REA");
    assert.equal(parsed.source, "PORTAL_EMAIL");
    assert.equal(parsed.name, "Lucy Tran");
    assert.equal(parsed.email, "lucy.t@example.com");
    assert.equal(parsed.phone, "0400 333 444");
    assert.equal(parsed.fields.property, "12 Marine Parade, Glenelg");
    assert.match(parsed.message ?? "", /still available/);
    assert.equal(parsed.externalId, "email:<abc@rea>");
  });

  it("falls back to the sender for a generic email", () => {
    const parsed = parseEnquiryEmail({ from: "Jane Owner <jane@example.com>", to: "x@y", subject: "Appraisal please", text: "Hi, could someone appraise my place at 5 Hill St?", messageId: null });
    assert.equal(parsed.provider, "GENERIC");
    assert.equal(parsed.source, "EMAIL");
    assert.equal(parsed.email, "jane@example.com");
    assert.equal(parsed.name, "Jane Owner");
    assert.match(parsed.message ?? "", /appraise my place/);
    // A number buried in a stranger's email is not trusted as an SMS destination; the reply goes to the sender's address.
    const withPhone = parseEnquiryEmail({ from: "ken@example.com", to: "x@y", subject: "Appraisal", text: "Call me on 0411 222 333 about my unit.", messageId: null });
    assert.equal(withPhone.phone, null);
    assert.equal(withPhone.email, "ken@example.com");
    assert.equal(withPhone.name, null);
    const labelled = parseEnquiryEmail({ from: "ken@example.com", to: "x@y", subject: "Appraisal", text: "Name: Ken Ho\nPhone: 0411 222 333\nMessage: appraisal please", messageId: null });
    assert.equal(labelled.phone, "0411 222 333");
  });
});

describe("meta lead forms", () => {
  it("verifies signatures, parses leadgen events and maps field data", () => {
    const raw = JSON.stringify({ object: "page", entry: [{ id: "page_1", changes: [{ field: "leadgen", value: { leadgen_id: "123", page_id: "page_1", form_id: "f1", ad_id: "a1", created_time: 1700000000 } }, { field: "feed", value: {} }] }] });
    const sig = "sha256=" + createHmac("sha256", "s3cret").update(raw).digest("hex");
    assert.equal(verifyMetaSignature(raw, sig, "s3cret"), true);
    assert.equal(verifyMetaSignature(raw, sig, "other"), false);
    assert.equal(verifyMetaSignature(raw, null, "s3cret"), false);
    const events = parseMetaLeadgenEvents(JSON.parse(raw));
    assert.deepEqual(events, [{ pageId: "page_1", leadgenId: "123", formId: "f1", adId: "a1", createdTime: 1700000000 }]);
    const mapped = mapMetaFieldData([{ name: "full_name", values: ["Dana W"] }, { name: "email", values: ["d@x.co"] }, { name: "phone_number", values: ["+61400000001"] }, { name: "what_suburb?", values: ["Glenelg"] }]);
    assert.equal(mapped.name, "Dana W");
    assert.equal(mapped.phone, "+61400000001");
    assert.equal(mapped.fields["what_suburb?"], "Glenelg");
  });

  it("resolves the tenant from the page id", async () => {
    const tenant = await repository.findTenantByIntegrationAccount("META", "page_1");
    assert.equal(tenant?.slug, "harbor-realty");
    assert.equal(await repository.findTenantByIntegrationAccount("META", "nope"), null);
  });
});

describe("E.164 by region", () => {
  it("adds the tenant country code when the caller omitted it", async () => {
    const { toE164 } = await import("@/lib/intake/schema");
    assert.equal(toE164("0400111222", "AU"), "+61400111222");
    assert.equal(toE164("+61400111222", "AU"), "+61400111222");
    assert.equal(toE164("61400111222", "AU"), "+61400111222");
    assert.equal(toE164("0212345678", "NZ"), "+64212345678");
    assert.equal(toE164("5551234567", "US"), "+15551234567");
    assert.equal(toE164(null, "AU"), null);
  });

  it("stores and messages leads in E.164 so dedupe and Twilio agree", async () => {
    const body = intakeSchema.parse({ source: "WEB_FORM", externalId: "e164_1", name: "Nat Phone", phone: "0400 777 000", message: "Appraisal for my Adelaide house please." });
    const result = await processIntake(harbor, body, {});
    assert.equal(result.outcome, "created");
    if (result.outcome !== "created") return;
    assert.equal(result.lead.phone, "+61400777000");
    const dup = await processIntake(harbor, intakeSchema.parse({ phone: "+61 400 777 000", message: "Appraisal for my Adelaide house please." }), {});
    assert.equal(dup.outcome, "duplicate", "the same enquiry again, with the number formatted differently, is one lead");
  });
});

describe("integration secrets", () => {
  it("round-trip with AES-GCM and reject tampering", () => {
    const enc = encryptSecret("EAAB-token");
    assert.equal(decryptSecret(enc), "EAAB-token");
    const [iv, tag, data] = enc.split(".");
    assert.throws(() => decryptSecret([iv, tag, data.slice(0, -2) + "zz"].join(".")));
  });
});
