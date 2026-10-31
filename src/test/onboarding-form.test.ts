import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { repository } from "@/lib/data";
import { describeAnswer, emptyTeamRow, fieldByKey, FIELDS, joinWithAnd, missingRequired, sanitizeAnswers, stepProgress, type OnboardingAnswers } from "@/lib/onboarding/form";
import { draftTenantDefinition, fromFormAnswers } from "@/lib/onboarding/questionnaire";
import { createOnboardingLink, draftFromOnboarding, LINK_DAYS, MAX_ANSWER_BYTES, openOnboarding, provisionFromOnboarding, renewOnboardingLink, reopenOnboarding, saveOnboardingAnswers, submitOnboarding, withdrawOnboarding } from "@/lib/onboarding/service";
import { applyDefinition } from "@/lib/tenants/definition";
import { provisionTenant } from "@/lib/tenants/provision";

/** A fictional gym's completed form, the way the browser sends it. */
const filled: OnboardingAnswers = {
  businessName: "Riverside Strength Studio",
  businessType: "Health and fitness",
  serviceAreas: "West End, South Brisbane",
  addresses: "12 Example Lane, West End QLD 4101",
  timezone: "Australia/Brisbane",
  currency: "AUD",
  phone: "07 3000 0000",
  website: "riverside.example.com",
  instagram: "https://instagram.com/riverside.example",
  contactName: "Morgan Lee",
  contactRole: "Owner",
  contactEmail: "morgan@riverside.example",
  contactMobile: "0400 111 222",
  greenCriteria: "Wants a membership or personal training\nLives or works nearby",
  autoHandled: "Opening hours\nClass timetable",
  requirePhone: "No",
  firstResponse: "15 minutes",
  bookingWindow: "48 hours",
  quietFrom: "21:00",
  quietTo: "07:00",
  quoteQuiet: "3 days",
  customerValue: "1200",
  reviewUrl: "https://g.page/r/riverside-example/review",
  pastCustomers: "No",
  inventory: "No",
  channels: { "Website forms": "30", "Social media messages and comments": "" },
  team: [
    { ...emptyTeamRow(), name: "Morgan Lee", title: "Owner", email: "morgan@riverside.example", mobile: "0400 111 222", alerts: true, approves: true, finances: true, users: true, allRecords: true },
    { ...emptyTeamRow(), name: "Casey Ng", title: "Head coach", email: "casey@riverside.example", alerts: true },
    { ...emptyTeamRow(), name: "No Email Person", alerts: true },
  ],
  escalateTo: "casey@riverside.example",
  signedBy: "The business",
  smsChoice: "existing",
  smsExisting: "0400 999 888",
  tools: { "Booking or scheduling": { tool: "Mindbody", access: "Yes" }, "Accounting and invoicing": { tool: "Xero", access: "Maybe" } },
  tasks: { "Email inbox management": { hours: "5", hand: "Yes" }, "Bookkeeping and reconciliation": { hours: "2", hand: "No" } },
  personality: "Warm, honest, energetic",
  voice: "Encouraging and plain-spoken",
  senderName: "Riverside Strength",
  replyTo: "hello@riverside.example",
  banned: "no pain no gain, guaranteed results",
  claims: "weight loss, injury recovery",
  socialChannels: ["Instagram", "Facebook"],
  postsPerWeek: "3",
  postingDays: ["Monday", "Thursday"],
  postingTime: "7am",
  adMeta: "400",
  consent: "Tick box at sign-up",
  confirm: "yes",
  signedName: "Morgan Lee",
};

describe("the onboarding form's own rules", () => {
  it("keeps only defined fields, bounded, in their own shape", () => {
    const clean = sanitizeAnswers({
      businessName: "x".repeat(1000),
      notAField: "dropped",
      businessType: "Banking",
      requirePhone: "Yes",
      socialChannels: ["Instagram", "MySpace", 7],
      channels: { "Website forms": "12", "Carrier pigeon": "3" },
      tasks: { "Email inbox management": { hours: "4", hand: "Definitely" } },
      team: Array.from({ length: 40 }, () => ({ name: "A", email: "a@example.com", alerts: "yes", approves: true })),
      confirm: "true",
    });
    assert.equal((clean.businessName as string).length, 300);
    assert.equal("notAField" in clean, false);
    assert.equal("businessType" in clean, false, "a value outside the options is dropped");
    assert.equal(clean.requirePhone, "Yes");
    assert.deepEqual(clean.socialChannels, ["Instagram"]);
    assert.deepEqual(clean.channels, { "Website forms": "12" });
    assert.deepEqual(clean.tasks, { "Email inbox management": { hours: "4", hand: "" } });
    const team = clean.team as { alerts: boolean; approves: boolean }[];
    assert.equal(team.length, 30);
    assert.equal(team[0].alerts, false, "only a real true ticks a permission");
    assert.equal(team[0].approves, true);
    assert.equal(clean.confirm, "");
  });

  it("knows what is still needed before it can be sent", () => {
    const blank = missingRequired({}).map((m) => m.label);
    assert.ok(blank.includes("Business name") && blank.includes("Your email") && blank.includes("Your full name"));
    assert.deepEqual(missingRequired(filled), []);
    assert.ok(missingRequired({ ...filled, contactEmail: "not an email" }).some((m) => m.label === "Your email"));
    assert.equal(joinWithAnd(missingRequired({ ...filled, confirm: "", signedName: "" }).map((m) => m.short)), "the confirmation tick and your full name");
    assert.equal(describeAnswer(fieldByKey("tasks")!, filled.tasks), "Email inbox management: 5 h/week, hand over\nBookkeeping and reconciliation: 2 h/week, keep in-house");
    const progress = stepProgress(filled);
    assert.ok(progress.business.answered > 10 && progress.send.answered === 2);
  });

  it("gives every field a unique key", () => {
    assert.equal(new Set(FIELDS.map((f) => f.key)).size, FIELDS.length);
  });
});

describe("drafting a workspace from the online form", () => {
  const { definition, review } = draftTenantDefinition(fromFormAnswers(sanitizeAnswers(filled)));

  it("maps the answers onto the same definition the file flow uses", () => {
    assert.equal(definition.templateKey, "health_fitness");
    assert.equal(definition.name, "Riverside Strength Studio");
    assert.deepEqual([definition.region, definition.timezone, definition.currency], ["AU", "Australia/Brisbane", "AUD"]);
    assert.equal(definition.fromName, "Riverside Strength");
    assert.equal(definition.replyTo, "hello@riverside.example");
    assert.equal(definition.signAsAssignee, false);
    assert.equal(definition.smsNumber, "+61400999888");
    assert.equal(definition.website, "riverside.example.com");
    assert.deepEqual(definition.social, { instagram: "https://instagram.com/riverside.example" });
    assert.deepEqual(definition.sla, { firstResponseMinutes: 15, bookingWindowHours: 48, quietHours: { start: 21, end: 7 } });
    assert.deepEqual(definition.qualification, { greenCriteria: ["Wants a membership or personal training", "Lives or works nearby"], autoHandled: ["Opening hours", "Class timetable"], requirePhone: false });
    assert.deepEqual(definition.content, { postsPerWeek: 3, slots: [{ day: 1, hour: 7 }, { day: 4, hour: 7 }] });
    assert.deepEqual(definition.people?.map((p) => [p.email, p.role]), [["morgan@riverside.example", "owner"], ["casey@riverside.example", "staff"]]);
    assert.deepEqual(definition.escalation, [{ when: "NOT_BOOKED", email: "casey@riverside.example" }, { when: "QUIET_QUOTE", email: "casey@riverside.example" }]);
    assert.deepEqual(definition.switchOff, { automations: ["reactivation"], modules: ["inventory"] });
    assert.equal(definition.opportunityValues?.NOT_BOOKED, 1200);
  });

  it("puts what needs a person on the review list", () => {
    for (const expected of ["No Email Person", "Website forms (30/month); Social media messages and comments", "Xero (access: Maybe); Mindbody", "Connect social channels: Instagram, Facebook", "Meta $400", "3 quiet days", "Tick box at sign-up"]) {
      assert.ok(review.some((r) => r.includes(expected)), `review mentions ${expected}`);
    }
  });
});

describe("the onboarding link, from creation to workspace", () => {
  it("runs the whole lifecycle and keeps the token out of every record", async () => {
    const now = new Date("2026-11-01T00:00:00Z");
    const { record, token } = await createOnboardingLink({ label: "Riverside Strength Studio", contactEmail: "Morgan@Riverside.example", createdById: null, now });
    assert.equal("tokenHash" in record, false);
    assert.equal(record.status, "INVITED");
    assert.equal(record.expiresAt.getTime(), now.getTime() + LINK_DAYS * 86_400_000);
    assert.deepEqual(record.answers, { businessName: "Riverside Strength Studio", contactEmail: "morgan@riverside.example" });

    assert.deepEqual(await openOnboarding("not-the-token", now), { ok: false, reason: "not_found" });
    assert.deepEqual(await saveOnboardingAnswers({ toString: () => token } as unknown as string, filled, now), { ok: false, reason: "not_found" }, "a token that is not a string is refused");
    assert.equal((await openOnboarding(token, new Date(now.getTime() + (LINK_DAYS + 1) * 86_400_000))).ok, false);

    const saved = await saveOnboardingAnswers(token, { businessName: "Riverside Strength Studio", sneaky: "<script>" }, now);
    assert.ok(saved.ok);
    const afterSave = await repository.findOnboardingById(record.id);
    assert.equal(afterSave?.status, "IN_PROGRESS");
    assert.ok(afterSave?.startedAt);
    assert.equal("sneaky" in (afterSave?.answers ?? {}), false);
    assert.deepEqual(await saveOnboardingAnswers(token, { example: "x".repeat(MAX_ANSWER_BYTES) }, now), { ok: false, reason: "too_large" });

    const early = await submitOnboarding(token, { businessName: "Riverside Strength Studio" }, now);
    assert.equal(early.ok, false);
    assert.ok(!early.ok && early.reason === "incomplete" && early.missing!.length > 0);

    assert.deepEqual(await submitOnboarding(token, filled, now), { ok: true });
    assert.equal((await repository.findOnboardingById(record.id))?.status, "SUBMITTED");
    assert.deepEqual(await saveOnboardingAnswers(token, filled, now), { ok: false, reason: "locked" });

    await reopenOnboarding(record.id, now);
    assert.equal((await saveOnboardingAnswers(token, filled, now)).ok, true);
    assert.deepEqual(await submitOnboarding(token, filled, now), { ok: true });

    const renewed = await renewOnboardingLink(record.id, now);
    assert.equal((await openOnboarding(token, now)).ok, false, "the old link stops working");
    assert.equal((await openOnboarding(renewed.token, now)).ok, true);

    const operator = await repository.findUserByEmail("ops@example.com");
    assert.ok(operator);
    const draft = draftFromOnboarding((await repository.findOnboardingById(record.id))!);
    assert.deepEqual(draft.blockers, []);
    assert.ok(draft.handOver.includes("Email inbox management (5 h/week): hand over"));

    const { tenant } = await provisionFromOnboarding(record.id, { operatorUserId: operator.user.id, now });
    assert.equal(tenant.slug, "riverside-strength-studio");
    assert.equal(tenant.sla.firstResponseMinutes, 15);
    const people = await repository.listTenantPeople(tenant.id);
    assert.ok(people.some((p) => p.email === "morgan@riverside.example" && p.via === "member"));
    assert.ok(people.some((p) => p.userId === operator.user.id && p.via === "operator"), "the operator who created it is assigned");
    const done = await repository.findOnboardingById(record.id);
    assert.equal(done?.status, "PROVISIONED");
    assert.equal(done?.tenantId, tenant.id);

    await assert.rejects(provisionFromOnboarding(record.id, { operatorUserId: operator.user.id }), /already created/);
    await assert.rejects(withdrawOnboarding(record.id), /already created/);
    assert.equal((await openOnboarding(renewed.token, now)).ok, true, "a finished questionnaire still opens, read-only");
  });

  it("withdraws a link, and refuses a workspace address that is taken or reserved", async () => {
    const { record, token } = await createOnboardingLink({ label: "Withdrawn Co", createdById: null });
    await withdrawOnboarding(record.id);
    assert.deepEqual(await openOnboarding(token), { ok: false, reason: "withdrawn" });
    await assert.rejects(createOnboardingLink({ label: "Bad Email Co", contactEmail: "nope", createdById: null }), /email/);

    await assert.rejects(provisionTenant({ templateKey: "generic", name: "Onboarding", slug: "onboarding", region: "AU", timezone: "Australia/Sydney", locale: "en-AU", currency: "AUD" }), /console page/);
    const def = { templateKey: "generic", name: "Taken Address Co", region: "AU", timezone: "Australia/Sydney", locale: "en-AU", currency: "AUD" };
    await applyDefinition(def, { refresh: false });
    await assert.rejects(applyDefinition(def, { refresh: false }), /already taken/);
    assert.equal((await applyDefinition(def, { refresh: true })).created, false);
  });
});
