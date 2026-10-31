import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { repository } from "@/lib/data";
import { ASK_ON_CALL, askedOnCall, CALL_SECTIONS, CLIENT_STEPS, describeAnswer, emptyTeamRow, fieldByKey, FIELDS, INDUSTRIES, joinWithAnd, missingRequired, presetTimezoneFor, sanitizeAnswers, stepProgress, type OnboardingAnswers } from "@/lib/onboarding/form";
import { draftTenantDefinition, fromFormAnswers } from "@/lib/onboarding/questionnaire";
import { createOnboardingLink, draftFromOnboarding, LINK_DAYS, MAX_ANSWER_BYTES, openOnboarding, provisionFromOnboarding, renewOnboardingLink, reopenOnboarding, saveCallSheet, saveOnboardingAnswers, submitOnboarding, withdrawOnboarding } from "@/lib/onboarding/service";
import { TEMPLATE_BY_KEY } from "@/lib/templates";
import { applyDefinition } from "@/lib/tenants/definition";
import { provisionTenant } from "@/lib/tenants/provision";

/** A fictional gym's short form, the way the browser sends it. */
const clientForm: OnboardingAnswers = {
  businessName: "Riverside Strength Studio",
  businessType: "Health and fitness",
  whatYouSell: "Small-group strength training",
  serviceAreas: "West End, South Brisbane",
  timezone: "Australia/Brisbane",
  phone: "07 3000 0000",
  website: "riverside.example.com",
  socialLinks: "https://instagram.com/riverside.example",
  contactName: "Morgan Lee",
  contactEmail: "morgan@riverside.example",
  contactMobile: "0400 111 222",
  team: [
    { ...emptyTeamRow(), name: "Morgan Lee", title: "Owner", email: "morgan@riverside.example", mobile: "0400 111 222", alerts: true, approves: true, finances: true, users: true, allRecords: true },
    { ...emptyTeamRow(), name: "Casey Ng", title: "Head coach", email: "casey@riverside.example", alerts: true },
    { ...emptyTeamRow(), name: "No Email Person", alerts: true },
  ],
  escalateTo: "casey@riverside.example",
  senderName: "Riverside Strength",
  replyTo: "hello@riverside.example",
  firstResponse: "15 minutes",
  quietFrom: "21:00",
  quietTo: "07:00",
  smsChoice: "existing",
  smsExisting: "0400 999 888",
  banned: "no pain no gain, guaranteed results",
  reviewUrl: "https://g.page/r/riverside-example/review",
  handOver: ["Email inbox management", "Reviews: asking for them and replying"],
  topGoal: "Stop missing trial enquiries",
  socialChannels: ["Instagram", "Facebook"],
  [ASK_ON_CALL]: ["reviewUrl", "serviceAreas"],
};

/** What the operator adds on the intake call. */
const callSheet: OnboardingAnswers = {
  greenCriteria: "Wants a membership or personal training\nLives or works nearby",
  autoHandled: "Opening hours\nClass timetable",
  requirePhone: "No",
  bookingWindow: "48 hours",
  quoteQuiet: "3 days",
  customerValue: "1200",
  pastCustomers: "No",
  inventory: "No",
  signedBy: "The business",
  channels: { "Website forms": "30", "Social media messages and comments": "" },
  tools: { "Booking or scheduling": { tool: "Mindbody", access: "Yes" }, "Accounting and invoicing": { tool: "Xero", access: "Maybe" } },
  tasks: { "Email inbox management": { hours: "5", hand: "Yes" }, "Bookkeeping and reconciliation": { hours: "2", hand: "No" } },
  personality: "Warm, honest, energetic",
  voice: "Encouraging and plain-spoken",
  claims: "weight loss, injury recovery",
  postsPerWeek: "3",
  postingDays: ["Monday", "Thursday"],
  postingTime: "7am",
  adMeta: "400",
  consent: "Tick box at sign-up",
};

describe("the onboarding form's own rules", () => {
  it("keeps the client to their own short form, bounded and in shape", () => {
    const clean = sanitizeAnswers(
      {
        businessName: "x".repeat(1000),
        notAField: "dropped",
        businessType: "Banking",
        greenCriteria: "a call-sheet field the client cannot set",
        socialChannels: ["Instagram", "MySpace", 7],
        team: Array.from({ length: 40 }, () => ({ name: "A", email: "a@example.com", alerts: "yes", approves: true })),
        [ASK_ON_CALL]: ["reviewUrl", "businessName", "greenCriteria", "reviewUrl"],
      },
      "client",
    );
    assert.equal((clean.businessName as string).length, 300);
    assert.equal("notAField" in clean, false);
    assert.equal("businessType" in clean, false, "a value outside the list is dropped");
    assert.equal("greenCriteria" in clean, false, "call-sheet fields are the operator's");
    assert.deepEqual(clean.socialChannels, ["Instagram"]);
    const team = clean.team as { alerts: boolean; approves: boolean }[];
    assert.equal(team.length, 30);
    assert.equal(team[0].alerts, false, "only a real true ticks a permission");
    assert.deepEqual(clean[ASK_ON_CALL], ["reviewUrl"], "only optional client questions can be left for the call");
    assert.equal(sanitizeAnswers({ greenCriteria: "kept" }).greenCriteria, "kept", "the call sheet can set every field");
  });

  it("asks for very little before it can be sent", () => {
    assert.deepEqual(missingRequired({}).map((m) => m.short), ["your business name", "your type of business", "your time zone", "your name", "your email address"]);
    assert.deepEqual(missingRequired(clientForm), []);
    assert.equal(joinWithAnd(missingRequired({ ...clientForm, businessType: "Other", contactEmail: "not an email" }).map((m) => m.short)), "what kind of business it is and your email address");
    const progress = stepProgress(clientForm);
    assert.deepEqual(Object.keys(progress), ["basics", "team", "customers", "plate"]);
    assert.ok(progress.basics.answered >= 10);
  });

  it("keeps the client form short and puts every one of its questions on the call sheet", () => {
    const clientKeys = CLIENT_STEPS.flatMap((s) => s.fields.map((f) => f.key));
    assert.ok(clientKeys.length <= 28, `the client form has ${clientKeys.length} fields`);
    const callKeys = new Set(CALL_SECTIONS.flatMap((s) => s.fields.map((f) => f.key)));
    for (const key of clientKeys) assert.ok(callKeys.has(key), `${key} is on the call sheet`);
    assert.equal(new Set(FIELDS.map((f) => f.key)).size, FIELDS.length, "every field key is unique");
  });

  it("offers a standard list of business types, each set up on a real template", () => {
    assert.ok(INDUSTRIES.length >= 15);
    assert.equal(new Set(INDUSTRIES.map((i) => i.label)).size, INDUSTRIES.length);
    for (const i of INDUSTRIES) assert.ok(TEMPLATE_BY_KEY[i.templateKey], `${i.label} → ${i.templateKey}`);
    assert.equal(INDUSTRIES.at(-1)?.label, "Other");
  });

  it("guesses a time zone from the browser and describes answers for the console", () => {
    assert.equal(presetTimezoneFor("Australia/Brisbane"), "Australia/Brisbane");
    assert.equal(presetTimezoneFor("Australia/Melbourne"), "Australia/Sydney");
    assert.equal(presetTimezoneFor("Asia/Tokyo"), undefined);
    assert.equal(describeAnswer(fieldByKey("tasks")!, callSheet.tasks), "Email inbox management: 5 h/week, hand over\nBookkeeping and reconciliation: 2 h/week, keep in-house");
    assert.deepEqual(askedOnCall(clientForm).map((f) => f.key), ["reviewUrl", "serviceAreas"]);
    assert.deepEqual(askedOnCall(sanitizeAnswers({ [ASK_ON_CALL]: ["phone"] }, "client")), [], "people know their own phone number");
  });
});

describe("drafting a workspace from the form and the call sheet", () => {
  const { definition, review } = draftTenantDefinition(fromFormAnswers(sanitizeAnswers({ ...clientForm, ...callSheet })));

  it("maps both onto the same definition the file flow uses", () => {
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

  it("sets each business type up on its closest template and says so", () => {
    const draft = (businessType: string, extra: OnboardingAnswers = {}) => draftTenantDefinition(fromFormAnswers(sanitizeAnswers({ businessName: "Example Co", businessType, timezone: "Australia/Sydney", ...extra })));
    assert.equal(draft("Allied health and wellness").definition.templateKey, "health_fitness");
    assert.equal(draft("Real estate and property").definition.templateKey, "real_estate");
    const cafe = draft("Hospitality");
    assert.equal(cafe.definition.templateKey, "generic");
    assert.ok(cafe.review.some((r) => r.includes("Hospitality") && r.includes("general template")));
    assert.ok(draft("Other", { businessTypeOther: "Dog grooming" }).review.some((r) => r.includes('"Dog grooming"')));
  });
});

describe("the onboarding link, from creation to workspace", () => {
  it("runs the whole lifecycle, keeps the token out of every record and never lets one side overwrite the other", async () => {
    const now = new Date("2026-11-01T00:00:00Z");
    const { record, token } = await createOnboardingLink({ label: "Riverside Strength Studio", contactEmail: "Morgan@Riverside.example", createdById: null, now });
    assert.equal("tokenHash" in record, false);
    assert.equal(record.status, "INVITED");
    assert.equal(record.expiresAt.getTime(), now.getTime() + LINK_DAYS * 86_400_000);
    assert.deepEqual(record.answers, { businessName: "Riverside Strength Studio", contactEmail: "morgan@riverside.example", quietFrom: "20:00", quietTo: "08:00" });

    assert.deepEqual(await openOnboarding("not-the-token", now), { ok: false, reason: "not_found" });
    assert.deepEqual(await saveOnboardingAnswers({ toString: () => token } as unknown as string, clientForm, now), { ok: false, reason: "not_found" }, "a token that is not a string is refused");
    assert.equal((await openOnboarding(token, new Date(now.getTime() + (LINK_DAYS + 1) * 86_400_000))).ok, false);

    // The operator fills in the call sheet while the client is still on their form.
    await saveCallSheet(record.id, callSheet);
    const saved = await saveOnboardingAnswers(token, { ...clientForm, greenCriteria: "the client tries to change a call-sheet answer" }, now);
    assert.ok(saved.ok);
    const merged = (await repository.findOnboardingById(record.id))!;
    assert.equal(merged.status, "IN_PROGRESS");
    assert.ok(merged.startedAt);
    assert.equal(merged.answers.greenCriteria, callSheet.greenCriteria, "the client's save keeps the call sheet's answers");
    assert.equal(merged.answers.topGoal, "Stop missing trial enquiries");
    assert.deepEqual(await saveOnboardingAnswers(token, { whatYouSell: "x".repeat(MAX_ANSWER_BYTES) }, now), { ok: false, reason: "too_large" });

    const early = await submitOnboarding(token, { businessName: "Riverside Strength Studio", timezone: "" }, now);
    assert.ok(!early.ok && early.reason === "incomplete" && early.missing!.length > 0);

    assert.deepEqual(await submitOnboarding(token, clientForm, now), { ok: true });
    assert.equal((await repository.findOnboardingById(record.id))?.status, "SUBMITTED");
    assert.deepEqual(await saveOnboardingAnswers(token, clientForm, now), { ok: false, reason: "locked" });
    await saveCallSheet(record.id, { bookingWindow: "24 hours" });
    assert.equal((await repository.findOnboardingById(record.id))?.answers.bookingWindow, "24 hours", "the call sheet stays open after the client sends");

    await reopenOnboarding(record.id, now);
    assert.equal((await saveOnboardingAnswers(token, clientForm, now)).ok, true);
    assert.deepEqual(await submitOnboarding(token, clientForm, now), { ok: true });

    const renewed = await renewOnboardingLink(record.id, now);
    assert.equal((await openOnboarding(token, now)).ok, false, "the old link stops working");
    assert.equal((await openOnboarding(renewed.token, now)).ok, true);

    const operator = await repository.findUserByEmail("ops@example.com");
    assert.ok(operator);
    const draft = draftFromOnboarding((await repository.findOnboardingById(record.id))!);
    assert.deepEqual(draft.blockers, []);
    assert.ok(draft.handOver.includes("Email inbox management (5 h/week): hand over"));
    assert.ok(draft.handOver.includes("Reviews: asking for them and replying: hand over"), "tasks ticked on the client's form count too");

    const { tenant } = await provisionFromOnboarding(record.id, { operatorUserId: operator.user.id, now });
    assert.equal(tenant.slug, "riverside-strength-studio");
    assert.deepEqual(tenant.sla, { firstResponseMinutes: 15, bookingWindowHours: 24, quietHours: { start: 21, end: 7 } });
    const people = await repository.listTenantPeople(tenant.id);
    assert.ok(people.some((p) => p.email === "morgan@riverside.example" && p.via === "member"));
    assert.ok(people.some((p) => p.userId === operator.user.id && p.via === "operator"), "the operator who created it is assigned");
    const done = await repository.findOnboardingById(record.id);
    assert.equal(done?.status, "PROVISIONED");
    assert.equal(done?.tenantId, tenant.id);

    await assert.rejects(provisionFromOnboarding(record.id, { operatorUserId: operator.user.id }), /already created/);
    await assert.rejects(saveCallSheet(record.id, { voice: "late change" }), /closed/);
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
