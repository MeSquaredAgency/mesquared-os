import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { repository } from "@/lib/data";
import { tenantReadiness } from "@/lib/launch/readiness";
import { answerFor, draftTenantDefinition, parseHours, parseMinutes, parseMoney, parseQuestionnaire, parseQuietHours, parseSlots, parseYesNo, presetFor, roleFor, splitList } from "@/lib/onboarding/questionnaire";
import { TEMPLATE_BY_KEY } from "@/lib/templates";
import { inviteMember, provisionTenant } from "@/lib/tenants/provision";
import { applyTenantSettings, tenantSettingsSchema } from "@/lib/tenants/settings";

const markdown = readFileSync(new URL("./fixtures/onboarding-questionnaire.md", import.meta.url), "utf8");

describe("reading free-text answers", () => {
  it("reads response times in minutes, smaller end of a range first", () => {
    assert.equal(parseMinutes("Under 5 minutes"), 5);
    assert.equal(parseMinutes("5-10 mins"), 5);
    assert.equal(parseMinutes("1 hour"), 60);
    assert.equal(parseMinutes("as soon as possible"), undefined);
  });

  it("reads booking windows in hours, days and weeks", () => {
    assert.equal(parseHours("2 days"), 48);
    assert.equal(parseHours("1 business day"), 24);
    assert.equal(parseHours("24h"), 24);
    assert.equal(parseHours("1 week"), 168);
    assert.equal(parseHours("same day"), 8);
    assert.equal(parseHours("72"), 72);
  });

  it("reads quiet hours across midnight", () => {
    assert.deepEqual(parseQuietHours("8pm to 8am"), { start: 20, end: 8 });
    assert.deepEqual(parseQuietHours("20:00-08:00"), { start: 20, end: 8 });
    assert.deepEqual(parseQuietHours("9 to 7am"), { start: 21, end: 7 });
    assert.equal(parseQuietHours("evenings"), undefined);
  });

  it("reads amounts, posting slots, yes/no, lists and time zones", () => {
    assert.equal(parseMoney("About $2,400 a year"), 2400);
    assert.equal(parseMoney("$1.5k"), 1500);
    assert.deepEqual(parseSlots("Mon 9am, Wednesday 5pm, Sat 8am"), [{ day: 1, hour: 9 }, { day: 3, hour: 17 }, { day: 6, hour: 8 }]);
    assert.equal(parseYesNo("Yes, always"), true);
    assert.equal(parseYesNo("No"), false);
    assert.equal(parseYesNo("depends"), undefined);
    assert.deepEqual(splitList("Glenelg, Brighton (and nearby), Somerton Park"), ["Glenelg", "Brighton (and nearby)", "Somerton Park"]);
    assert.deepEqual(splitList("Owns property; wants a sale, lease or appraisal\n- gives a phone"), ["Owns property", "wants a sale, lease or appraisal", "gives a phone"]);
    assert.equal(presetFor("Adelaide, AUD")?.timezone, "Australia/Adelaide");
    assert.equal(presetFor("AEST")?.timezone, "Australia/Sydney");
    assert.equal(presetFor("Auckland")?.region, "NZ");
    assert.equal(presetFor("somewhere"), undefined);
  });

  it("maps ticked permissions to the closest template role", () => {
    assert.deepEqual(roleFor("real_estate", ["RECEIVE_LEAD_ALERTS"]), { key: "staff", name: "Property Manager", exact: true });
    assert.deepEqual(roleFor("real_estate", []), { key: "team", name: "Team member", exact: true });
    assert.deepEqual(roleFor("real_estate", ["RECEIVE_LEAD_ALERTS", "APPROVE_CONTENT"]), { key: "manager", name: "Region Manager", exact: false });
    assert.equal(roleFor("generic", ["VIEW_FINANCES"]).key, "accountant");
  });
});

describe("parsing an exported questionnaire", () => {
  const parsed = parseQuestionnaire(markdown);

  it("reads question rows, header-row pairs and escaped pipes", () => {
    assert.equal(answerFor(parsed, "businessName"), "Coastline Property Co");
    assert.equal(answerFor(parsed, "businessType"), "Real estate");
    assert.equal(answerFor(parsed, "footer"), "Coastline Property Co | RLA 000001");
    assert.equal(answerFor(parsed, "smsNumber"), "Yes, we text from 0400 000 009");
  });

  it("reads checklists with their section", () => {
    const social = parsed.checks.filter((c) => c.section === "content, social and advertising" && c.checked).map((c) => c.label);
    assert.deepEqual(social, ["Facebook", "Instagram", "Google Business Profile"]);
  });
});

describe("drafting a workspace definition", () => {
  const { definition, review } = draftTenantDefinition(parseQuestionnaire(markdown));

  it("fills the workspace basics, sender and signature details", () => {
    assert.equal(definition.templateKey, "real_estate");
    assert.equal(definition.name, "Coastline Property Co");
    assert.equal(definition.slug, "coastline-property-co");
    assert.deepEqual([definition.region, definition.timezone, definition.locale, definition.currency], ["AU", "Australia/Adelaide", "en-AU", "AUD"]);
    assert.equal(definition.fromName, "Coastline Property Co");
    assert.equal(definition.replyTo, "office@coastline.example");
    assert.equal(definition.requiredFooter, "Coastline Property Co | RLA 000001");
    assert.equal(definition.signAsAssignee, true);
    assert.equal(definition.smsNumber, "+61400000009");
    assert.equal(definition.website, "coastline.example.com.au");
    assert.deepEqual(definition.social, { facebook: "https://facebook.com/coastlineexample", instagram: "https://instagram.com/coastlineexample" });
    assert.deepEqual(definition.serviceAreas, ["Glenelg", "Brighton", "Somerton Park"]);
  });

  it("gives each team member the role their ticks describe, and skips people without an email", () => {
    assert.deepEqual(
      definition.people?.map((p) => [p.email, p.role, p.title ?? null, p.mobile ?? null]),
      [
        ["dana@coastline.example", "owner", "Director", "0400 000 001"],
        ["sam@coastline.example", "staff", "Property Manager", "0400 000 002"],
        ["lee@books.example", "accountant", "Bookkeeper", null],
        ["alex@coastline.example", "manager", "Sales agent", null],
      ],
    );
    assert.ok(review.some((r) => r.includes("Jo Bloggs") && r.includes("no email")));
    assert.ok(review.some((r) => r.startsWith("Alex Kim") && r.includes("Region Manager")));
  });

  it("turns the answers into service levels, qualification, brand, values and content settings", () => {
    assert.deepEqual(definition.sla, { firstResponseMinutes: 5, bookingWindowHours: 48, quietHours: { start: 20, end: 8 } });
    assert.deepEqual(definition.qualification, {
      greenCriteria: ["Owns a property in our area", "wants management, an appraisal or a sale", "gives a phone number"],
      highIntentServices: ["Appraisals", "property management"],
      autoHandled: ["Rental availability", "inspection times", "rental applications"],
      requirePhone: true,
    });
    assert.deepEqual(definition.brand?.bannedPhrases, ["guaranteed", "cheapest", "dream home"]);
    assert.match(definition.brand?.voice ?? "", /^Friendly and plain-spoken, never pushy Personality: Local, calm, straight-talking\.$/);
    assert.equal(definition.opportunityValues?.NOT_BOOKED, 2400);
    assert.equal(definition.opportunityValues?.ABANDONED_FORM, 800);
    assert.deepEqual(definition.content, { postsPerWeek: 3, slots: [{ day: 1, hour: 9 }, { day: 3, hour: 17 }, { day: 6, hour: 8 }] });
    assert.equal(definition.reviewUrl, "https://g.page/r/coastline-example/review");
    assert.deepEqual(definition.escalation, [{ when: "NOT_BOOKED", email: "dana@coastline.example" }, { when: "QUIET_QUOTE", email: "dana@coastline.example" }]);
    assert.deepEqual(definition.switchOff, { automations: ["reactivation"] });
    assert.ok(tenantSettingsSchema.safeParse(definition).success);
  });

  it("leaves what the file cannot do on the review list", () => {
    for (const expected of ["quietAfterDays", "Cal.com", "Set up intake for", "Xero (access: Maybe)", "Connect social channels: Facebook, Instagram, Google Business Profile", "Meta $600", "Tick box on the appraisal form"]) {
      assert.ok(review.some((r) => r.includes(expected)), `review mentions ${expected}`);
    }
  });

  it("drafts something provisionable from an empty questionnaire, and says what is missing", () => {
    const empty = draftTenantDefinition(parseQuestionnaire("# Me² Client Onboarding Questionnaire\n"));
    assert.equal(empty.definition.templateKey, "generic");
    assert.equal(empty.definition.people, undefined);
    assert.ok(empty.review.some((r) => r.startsWith("No business name")));
    assert.ok(empty.review.some((r) => r.startsWith("No team members")));
  });
});

describe("applying the drafted settings to a workspace", () => {
  it("lands every setting through the repository and passes the people checks in readiness", async () => {
    const { definition } = draftTenantDefinition(parseQuestionnaire(markdown));
    const tenant = await provisionTenant({ templateKey: definition.templateKey, name: definition.name, slug: "coastline-questionnaire", region: definition.region, timezone: definition.timezone, locale: definition.locale, currency: definition.currency, fromName: definition.fromName ?? null, replyTo: definition.replyTo ?? null, primaryColor: null, serviceAreas: definition.serviceAreas ?? [], requiredFooter: definition.requiredFooter ?? null });
    const config = await repository.getTenantConfig(tenant.id);
    const template = TEMPLATE_BY_KEY[definition.templateKey];
    for (const person of definition.people ?? []) {
      const role = config.roles.find((r) => r.name === template.roles.find((t) => t.key === person.role)?.name);
      assert.ok(role, `role for ${person.email}`);
      await inviteMember(tenant.id, { email: person.email, name: person.name, roleId: role.id, profile: { title: person.title ?? null, phone: person.mobile ?? null, photoUrl: null } });
    }

    const log = await applyTenantSettings(tenant.id, definition);
    assert.ok(log.length >= 7);

    const after = await repository.findTenantById(tenant.id);
    assert.deepEqual(after?.sla, { firstResponseMinutes: 5, bookingWindowHours: 48, quietHours: { start: 20, end: 8 } });
    assert.equal(after?.qualificationRules.requirePhone, true);
    assert.deepEqual(after?.qualificationRules.serviceAreas, ["Glenelg", "Brighton", "Somerton Park"]);
    assert.equal(after?.opportunityValues.NOT_BOOKED, 240000);
    const dana = (await repository.listTenantPeople(tenant.id)).find((p) => p.email === "dana@coastline.example");
    assert.deepEqual(after?.escalationRules, [{ when: "NOT_BOOKED", notifyUserId: dana?.userId }, { when: "QUIET_QUOTE", notifyUserId: dana?.userId }]);

    const cfg = await repository.getTenantConfig(tenant.id);
    assert.ok(cfg.brand?.bannedPhrases.includes("guaranteed rent"), "template phrases are kept");
    assert.ok(cfg.brand?.bannedPhrases.includes("dream home"), "client phrases are added");
    assert.match(cfg.brand?.complianceBlock.claimsPolicy ?? "", /Sale prices, rental yields/);
    assert.equal(cfg.brand?.complianceBlock.requiredFooter, "Coastline Property Co | RLA 000001");
    assert.deepEqual(cfg.modules.find((m) => m.moduleKey === "content")?.settings, { postsPerWeek: 3, slots: [{ day: 1, hour: 9 }, { day: 3, hour: 17 }, { day: 6, hour: 8 }] });
    assert.equal(cfg.automations.find((a) => a.typeKey === "review_request")?.settings.reviewUrl, "https://g.page/r/coastline-example/review");

    const checks = await tenantReadiness(after!);
    assert.equal(checks.find((c) => c.key === "alerts")?.ok, true);
    assert.equal(checks.find((c) => c.key === "escalation")?.ok, true);
    assert.equal(checks.find((c) => c.key === "footer")?.ok, true);
  });

  it("refuses an escalation that names someone outside the workspace", async () => {
    const tenant = await provisionTenant({ templateKey: "generic", name: "Escalation Check Co", slug: "", region: "AU", timezone: "Australia/Sydney", locale: "en-AU", currency: "AUD", fromName: null, replyTo: null, primaryColor: null, serviceAreas: [], requiredFooter: null });
    await assert.rejects(applyTenantSettings(tenant.id, { escalation: [{ when: "NOT_BOOKED", email: "stranger@example.com" }] }), /not a member/);
    await assert.rejects(applyTenantSettings(tenant.id, { sla: { firstResponseMinutes: 0 } }));
  });
});
