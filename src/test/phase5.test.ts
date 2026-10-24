import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { registerAutomations } from "@/lib/automations/handlers";
import { verifyPassword } from "@/lib/auth/password";
import { registerContentEngine } from "@/lib/content/engine";
import { hashApiKey } from "@/lib/crypto";
import { repository } from "@/lib/data";
import { demoTenants } from "@/lib/data/fixtures";
import { processIntake } from "@/lib/intake/process";
import { intakeSchema } from "@/lib/intake/schema";
import { csvToInventory, describeListing, findListingMentioned, importInventory, parseCsv, registerInventory } from "@/lib/inventory";
import { platformReadiness, readinessSummary, tenantReadiness } from "@/lib/launch/readiness";
import { inviteMember, issueApiKey, provisionTenant, slugify, temporaryPassword } from "@/lib/tenants/provision";
import type { TenantSummary } from "@/lib/types";

const harbor = demoTenants[0];

before(() => {
  process.env.MESSAGING_MODE = "log";
  process.env.SOCIAL_MODE = "log";
  process.env.CONTENT_ENGINE = "stub";
  process.env.DEFAULT_FROM_EMAIL = "hello@example.com";
  registerAutomations();
  registerContentEngine();
  registerInventory();
});

let fresh: TenantSummary;

describe("provisioning a workspace from a template", () => {
  it("creates the tenant, applies the template and records the footer", async () => {
    fresh = await provisionTenant({ templateKey: "real_estate", name: "Coastline Property Co", slug: "", region: "au", timezone: "Australia/Adelaide", locale: "en-AU", currency: "aud", fromName: "Coastline Property", replyTo: "office@coastline.example", serviceAreas: ["Glenelg", "Brighton"], requiredFooter: "Coastline Property Co | RLA 000001" });
    assert.equal(fresh.slug, "coastline-property-co");
    assert.equal(fresh.industry, "REAL_ESTATE");
    assert.equal(fresh.templateKey, "real_estate");
    assert.equal(fresh.region, "AU");
    assert.equal(fresh.currency, "AUD");
    assert.equal(fresh.branding.fromName, "Coastline Property");
    assert.deepEqual(fresh.qualificationRules.serviceAreas, ["Glenelg", "Brighton"]);
    const config = await repository.getTenantConfig(fresh.id);
    assert.ok(config.roles.length >= 3 && config.pipelines.length >= 1, "roles and pipelines from the template");
    assert.ok(config.modules.some((m) => m.moduleKey === "inventory" && m.enabled), "RE template turns inventory on");
    assert.ok(config.automations.some((a) => a.typeKey === "enquiry_auto_reply" && a.enabled));
    assert.equal(config.brand?.complianceBlock.requiredFooter, "Coastline Property Co | RLA 000001");
    assert.ok(!config.automations.find((a) => a.typeKey === "reactivation")?.enabled, "reactivation stays off for real estate");
  });

  it("slugs are safe and short names are refused", async () => {
    assert.equal(slugify("  Summit Health & Fitness! "), "summit-health-fitness");
    await assert.rejects(() => provisionTenant({ templateKey: "generic", name: "A", slug: "", region: "AU", timezone: "Australia/Adelaide", locale: "en-AU", currency: "AUD" }), /three characters/);
    await assert.rejects(() => provisionTenant({ templateKey: "nope", name: "Somebody", slug: "", region: "AU", timezone: "Australia/Adelaide", locale: "en-AU", currency: "AUD" }), /Unknown template/);
  });

  it("the new workspace is isolated from the demo tenants", async () => {
    const leads = await repository.listRecentLeads(fresh.id, 50);
    assert.equal(leads.length, 0);
    assert.equal((await repository.listInventory(fresh.id)).length, 0);
    assert.ok((await repository.listRecentLeads(harbor.id, 50)).length > 0, "demo data untouched");
  });
});

describe("people and sign-in", () => {
  it("invites a member with a one-time password that signs in, and resets without creating a duplicate", async () => {
    const config = await repository.getTenantConfig(fresh.id);
    const owner = config.roles.find((r) => r.permissions.includes("MANAGE_USERS"))!;
    const invite = await inviteMember(fresh.id, { email: "Owner@Coastline.example", name: "Dana Reyes", roleId: owner.id });
    assert.ok(invite.created && invite.temporaryPassword, "new account gets a one-time password");
    assert.match(invite.temporaryPassword!, /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    const found = await repository.findUserByEmail("owner@coastline.example");
    assert.ok(found && (await verifyPassword(invite.temporaryPassword!, found.passwordHash)), "password verifies");
    assert.equal(await verifyPassword("wrong-wrong-wrong-wrong", found!.passwordHash), false);
    const people = await repository.listTenantPeople(fresh.id);
    const dana = people.find((p) => p.email === "owner@coastline.example");
    assert.ok(dana && dana.via === "member" && dana.roleName === owner.name && dana.permissions.includes("RECEIVE_LEAD_ALERTS"));

    const again = await inviteMember(fresh.id, { email: "owner@coastline.example", name: null, roleId: owner.id });
    assert.equal(again.created, false);
    assert.equal(again.temporaryPassword, null, "existing accounts keep their password");
    assert.equal((await repository.listTenantPeople(fresh.id)).filter((p) => p.email === "owner@coastline.example").length, 1, "membership upserted, not duplicated");

    const reset = await inviteMember(fresh.id, { email: "owner@coastline.example", name: null, roleId: owner.id, resetPassword: true });
    assert.ok(reset.temporaryPassword && reset.temporaryPassword !== invite.temporaryPassword);
    const after = await repository.findUserByEmail("owner@coastline.example");
    assert.equal(await verifyPassword(invite.temporaryPassword!, after!.passwordHash), false, "old password no longer works");
    assert.equal(await verifyPassword(reset.temporaryPassword!, after!.passwordHash), true);
  });

  it("removing a membership and assigning an operator show up in people", async () => {
    const people = await repository.listTenantPeople(fresh.id);
    const dana = people.find((p) => p.via === "member")!;
    const operators = await repository.listOperators();
    assert.ok(operators.length > 0, "demo operators exist");
    await repository.assignOperator(fresh.id, operators[0].id);
    const withOp = await repository.listTenantPeople(fresh.id);
    assert.ok(withOp.some((p) => p.via === "operator" && p.userId === operators[0].id));
    await repository.removeMembership(fresh.id, dana.userId);
    assert.ok(!(await repository.listTenantPeople(fresh.id)).some((p) => p.userId === dana.userId && p.via === "member"));
    // Put Dana back for the readiness checks below.
    const config = await repository.getTenantConfig(fresh.id);
    await repository.upsertMembership(fresh.id, dana.userId, config.roles.find((r) => r.permissions.includes("RECEIVE_LEAD_ALERTS"))!.id);
  });

  it("temporary passwords are unpredictable", () => {
    const set = new Set(Array.from({ length: 50 }, () => temporaryPassword()));
    assert.equal(set.size, 50);
  });
});

describe("API keys", () => {
  it("issues a key shown once, resolves it by hash with its scopes, and revokes it", async () => {
    const issued = await issueApiKey(fresh.id, "Website forms", ["intake"]);
    assert.match(issued.raw, /^msq_live_[A-Za-z0-9_-]{32}$/);
    assert.equal(issued.key.keyPrefix, issued.raw.slice(0, 15));
    assert.deepEqual(issued.key.scopes, ["intake"]);
    const listed = await repository.listApiKeys(fresh.id);
    assert.equal(listed.length, 1);
    assert.ok(!("keyHash" in listed[0]), "the hash never leaves the repository");
    const resolved = await repository.findTenantByApiKeyHash(hashApiKey(issued.raw));
    assert.equal(resolved?.tenant.id, fresh.id);
    assert.deepEqual(resolved?.scopes, ["intake"]);
    assert.equal(resolved?.apiKeyId, issued.key.id);
    assert.equal(await repository.findTenantByApiKeyHash(hashApiKey(issued.raw + "x")), null);
    await repository.revokeApiKey(fresh.id, issued.key.id);
    assert.equal(await repository.findTenantByApiKeyHash(hashApiKey(issued.raw)), null, "revoked keys stop resolving");
    assert.ok((await repository.listApiKeys(fresh.id))[0].revokedAt, "listed as revoked");
    const second = await issueApiKey(fresh.id, "Uploads", ["content"]);
    await repository.revokeApiKey(harbor.id, second.key.id);
    assert.equal((await repository.findTenantByApiKeyHash(hashApiKey(second.raw)))?.tenant.id, fresh.id, "another tenant's revoke is a no-op");
    await repository.revokeApiKey(fresh.id, second.key.id);
  });

  it("the demo keys keep working with both scopes", async () => {
    const demo = await repository.findTenantByApiKeyHash(hashApiKey("msq_live_demo_one_0000000000000000"));
    assert.equal(demo?.tenant.id, harbor.id);
    assert.ok(demo!.scopes.includes("intake") && demo!.scopes.includes("content"));
  });
});

describe("settings and readiness", () => {
  it("updates settings through the repository and flips modules and automations", async () => {
    const updated = await repository.updateTenant(fresh.id, { name: "Coastline Property Group", sla: { firstResponseMinutes: 3, bookingWindowHours: 48, quietHours: { start: 21, end: 7 } }, escalationRules: [{ when: "*", notifyUserId: "u_test" }], opportunityValues: { MISSED_CALL: 50_000 } });
    assert.ok(updated);
    assert.equal(updated.name, "Coastline Property Group");
    assert.equal(updated.sla.firstResponseMinutes, 3);
    assert.equal(updated.escalationRules.length, 1);
    assert.equal(updated.opportunityValues.MISSED_CALL, 50_000);
    await repository.setModule(fresh.id, "inventory", { enabled: false });
    assert.equal((await repository.getTenantConfig(fresh.id)).modules.find((m) => m.moduleKey === "inventory")?.enabled, false);
    await repository.setModule(fresh.id, "inventory", { enabled: true, settings: { draftOnNew: true } });
    await repository.setAutomation(fresh.id, "content_engine", { enabled: false });
    assert.equal((await repository.getTenantConfig(fresh.id)).automations.find((a) => a.typeKey === "content_engine")?.enabled, false);
    await repository.setAutomation(fresh.id, "content_engine", { enabled: true });
    await repository.updateBrandProfile(fresh.id, { voice: "Warm and precise.", bannedPhrases: ["guaranteed"] });
    const brand = (await repository.getTenantConfig(fresh.id)).brand!;
    assert.equal(brand.voice, "Warm and precise.");
    assert.equal(brand.complianceBlock.requiredFooter, "Coastline Property Co | RLA 000001", "footer kept when other fields change");
    fresh = (await repository.findTenantById(fresh.id))!;
  });

  it("readiness tells the operator what is still needed, in plain words", async () => {
    const checks = await tenantReadiness(fresh);
    const by = Object.fromEntries(checks.map((c) => [c.key, c]));
    assert.equal(by.template.ok, true);
    assert.equal(by.alerts.ok, true, "Dana receives lead alerts");
    assert.equal(by.operator.ok, true);
    assert.equal(by.footer.level, "required", "footer is required for real estate");
    assert.equal(by.footer.ok, true);
    assert.equal(by["api-key"].ok, false, "the only key was revoked");
    assert.equal(by.messaging.ok, false, "log mode never counts as live");
    assert.match(by.messaging.detail, /nothing is sent/);
    const summary = readinessSummary(checks);
    assert.equal(summary.ready, false);
    assert.ok(summary.requiredPassed < summary.requiredTotal);
    for (const c of checks) assert.doesNotMatch(`${c.label} ${c.detail}`, /\b(green|red)\b/i, "no traffic-light words");
  });

  it("platform readiness reads the environment, not the process", () => {
    const bare = platformReadiness({});
    const byKey = Object.fromEntries(bare.map((c) => [c.key, c]));
    assert.equal(byKey["auth-secret"].ok, false);
    assert.equal(byKey["public-url"].ok, false);
    const good = platformReadiness({ AUTH_SECRET: "x".repeat(40), INTEGRATION_ENCRYPTION_KEY: "y".repeat(32), JOB_SECRET: "z", NEXT_PUBLIC_APP_URL: "https://app.example.com", MESSAGING_MODE: "live", TWILIO_ACCOUNT_SID: "AC1" });
    const g = Object.fromEntries(good.map((c) => [c.key, c]));
    assert.ok(g["auth-secret"].ok && g["encryption-key"].ok && g["job-secret"].ok && g["public-url"].ok && g["messaging-live"].ok);
    assert.equal(platformReadiness({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" }).find((c) => c.key === "public-url")?.ok, false);
  });
});

describe("inventory", () => {
  const csv = `address,suburb,status,rent,bedrooms,bathrooms,url,available,reference\n"12 Marine Parade",Glenelg,available,620,2,1,https://coastline.example/12-marine,"1 Nov",L-1\n"4/8 Jetty Road",Brighton,leased,"$540",1,1,,,L-2\n,Glenelg,available,500,,,,,\n`;

  it("parses CSV with quotes and maps columns to listings", () => {
    assert.deepEqual(parseCsv('a,"b, c",d\n1,"say ""hi""",3')[1], ["1", 'say "hi"', "3"]);
    const { items, skipped } = csvToInventory(csv);
    assert.equal(skipped, 1, "a row without a name or address is skipped");
    assert.equal(items.length, 2);
    const [marine, jetty] = items;
    assert.equal(marine.name, "12 Marine Parade");
    assert.equal(marine.status, "ACTIVE");
    assert.equal(marine.attributes!.rentPerWeekCents, 62_000);
    assert.equal(marine.attributes!.url, "https://coastline.example/12-marine");
    assert.equal(marine.externalId, "L-1");
    assert.equal(jetty.status, "UNAVAILABLE");
    assert.equal(jetty.attributes!.rentPerWeekCents, 54_000);
  });

  it("imports idempotently, drafts a post for the new active listing, and the enquiry reply names it", async () => {
    await repository.upsertChannel(fresh.id, { platform: "FACEBOOK", externalAccountId: "fb_coastline", displayName: "Coastline Property" });
    const first = await importInventory(fresh, csvToInventory(csv).items);
    assert.deepEqual(first, { created: 2, updated: 0 });
    const second = await importInventory(fresh, csvToInventory(csv.replace("620", "640")).items);
    assert.equal(second.created, 0, "same reference is an update");
    assert.ok(second.updated >= 1);
    const items = await repository.listInventory(fresh.id);
    assert.equal(items.length, 2);
    assert.equal(items.find((i) => i.externalId === "L-1")?.attributes.rentPerWeekCents, 64_000);
    assert.equal((await repository.listInventory(harbor.id)).some((i) => i.externalId === "L-1"), false, "isolated");

    // The new active listing became material for the content engine (the leased one did not).
    const workbench = await repository.getWorkbench(fresh.id);
    const sources = workbench.sources.filter((s) => s.title?.includes("Just listed"));
    assert.equal(sources.length, 1, "one source for the one active listing");
    assert.match(sources[0].title ?? "", /12 Marine Parade/);
    assert.ok(workbench.assets.some((a) => a.parentId === sources[0].id), "drafts exist for it");

    const listing = await findListingMentioned(fresh.id, "Hi, is 12 marine parade still available? Looking to rent.");
    assert.equal(listing?.externalId, "L-1");
    assert.equal(await findListingMentioned(fresh.id, "4/8 Jetty Road please"), null, "leased listings are not offered");
    assert.match(describeListing(listing!, fresh.locale, fresh.currency), /12 Marine Parade · Glenelg · 2 beds · \$640 per week · available 1 Nov/);

    const result = await processIntake(fresh, intakeSchema.parse({ source: "WEB_FORM", firstName: "Sam", phone: "+61400777888", email: "sam@example.com", message: "Hi, is 12 Marine Parade still available? Looking to rent and would like an inspection time." }), {});
    assert.ok(result.outcome !== "dry_run" && "lead" in result && result.lead.ticketType === "RED", "renter enquiry handled automatically");
    const runs = await repository.listAutomationRuns(fresh.id, 20);
    const reply = runs.find((r) => r.typeKey === "enquiry_auto_reply");
    assert.ok(reply, "the renter got an automatic reply");
    assert.match(reply!.summary, /12 Marine Parade/);
    assert.doesNotMatch(reply!.summary, /\b(green|red)\b/i);
  });
});
