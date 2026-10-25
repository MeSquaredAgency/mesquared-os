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

describe("signing as the assigned person", () => {
  it("resolves the assignee's first name and email only when the switch is on and the lead is assigned to a member", async () => {
    const { senderIdentity, templates } = await import("@/lib/messaging");
    const dana = (await repository.listTenantPeople(fresh.id)).find((p) => p.via === "member")!;
    assert.deepEqual(await senderIdentity(fresh, dana.userId), { signedBy: null, replyTo: null, userId: null, signature: null }, "off by default");
    fresh = (await repository.updateTenant(fresh.id, { branding: { ...fresh.branding, signAsAssignee: true } }))!;
    await repository.upsertMembership(fresh.id, dana.userId, dana.roleId!, { title: "Property Manager", phone: "0400 000 000", photoUrl: "https://coastline.example/dana.png" });
    const identity = await senderIdentity(fresh, dana.userId);
    assert.equal(identity.signedBy, "Dana");
    assert.equal(identity.replyTo, "owner@coastline.example");
    assert.deepEqual(identity.signature, { name: "Dana Reyes", title: "Property Manager", phone: "0400 000 000", email: "owner@coastline.example", photoUrl: "https://coastline.example/dana.png" }, "signature details come from the membership");
    assert.deepEqual(await senderIdentity(fresh, null), { signedBy: null, replyTo: null, userId: null, signature: null }, "unassigned leads are signed by the business");
    assert.equal((await senderIdentity(fresh, "user_ops")).signedBy, null, "operators never sign client messages");

    const signed = templates.bookingConfirmation({ tenant: fresh, firstName: "Sam", when: null, channel: "EMAIL", signedBy: "Dana" });
    assert.match(signed.body, /Kind regards,\nDana, Coastline Property\n/);
    assert.match(signed.body, /automated message from Dana at Coastline Property Group/);
    const sms = templates.acknowledgementSms({ tenant: fresh, firstName: "Sam", bookingUrl: "https://x/y", topic: null, signedBy: "Dana" });
    assert.match(sms, /Dana will get back to you/);
    assert.match(sms, /automated reply from Dana at Coastline Property Group/);
    const unsigned = templates.bookingConfirmation({ tenant: fresh, firstName: "Sam", when: null, channel: "EMAIL" });
    assert.doesNotMatch(unsigned.body, /Dana/);
    assert.match(unsigned.body, /Kind regards,\nCoastline Property\nCoastline Property Co \| RLA 000001\n/, "the required footer sits under every email signature");
  });

  it("renders every email in the branded layout: logo, bar, button, signature block, licence line", async () => {
    const { templates } = await import("@/lib/messaging");
    const { renderEmailHtml } = await import("@/lib/messaging/email-layout");
    const email = templates.generalReply({ tenant: fresh, firstName: "Sam", channel: "EMAIL", custom: null, infoUrl: "https://coastline.example/rentals?a=1&b=2", topic: "rentals", area: "Glenelg" });
    assert.match(email.body, /^Hi Sam,\n\nThanks for your message to Coastline Property Group about rentals in Glenelg/, "email greetings get a paragraph break and a capital; topic and area are named");
    assert.deepEqual(email.cta, { label: "See details and times", url: "https://coastline.example/rentals?a=1&b=2" });
    const html = renderEmailHtml(fresh, email.body, { cta: email.cta });
    assert.match(html, /<td style="height:4px;background:#0f4c81/, "a bar in the brand colour under the header");
    assert.match(html, /<a href="https:\/\/coastline.example\/rentals\?a=1&amp;b=2" style="display:inline-block[^"]*">See details and times<\/a>/, "the link becomes a button");
    assert.doesNotMatch(html, /here: <a/, "the raw link sentence is gone from the body");
    assert.match(html, /Coastline Property Co \| RLA 000001<\/div>/, "licence line sits in the signature block");
    assert.equal((html.match(/RLA 000001/g) ?? []).length, 1, "the footer line is not repeated");
    assert.match(html, /Reply to this email to reach a person/);
    const hostile = renderEmailHtml(fresh, "Hi,\n<script>alert(1)</script> & co\n\nKind regards,\nX");
    assert.doesNotMatch(hostile, /<script>/);
    assert.match(hostile, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; co/);
    const branded = { ...fresh, branding: { ...fresh.branding, primaryColor: "#8dc600", logoUrl: "https://coastline.example/logo.png", website: "coastline.example", phone: "1300 000 000", addresses: ["Glenelg: 1 Jetty Rd"], social: { facebook: "https://www.facebook.com/coastline" } } };
    const signed = renderEmailHtml(branded, email.body, { cta: email.cta, signature: { name: "Dana Owner", title: "Property Manager", phone: "0400 000 000", email: "owner@coastline.example", photoUrl: "https://coastline.example/dana.png" } });
    assert.match(signed, /<img src="https:\/\/coastline.example\/logo.png" alt="Coastline Property" height="44"/, "the logo heads the email");
    assert.match(signed, /background:#8dc600/);
    assert.match(signed, /<img src="https:\/\/coastline.example\/dana.png" width="72"/, "the signer's photo");
    assert.match(signed, /Dana Owner<\/div><div[^>]*>Property Manager<\/div>/, "name and title");
    assert.match(signed, /tel:\+61400000000[^>]*>0400 000 000<\/a>/, "mobile as a tel link");
    assert.match(signed, /tel:\+611300000000|tel:1300000000/, "office phone");
    assert.match(signed, /href="https:\/\/coastline.example"[^>]*>coastline.example</, "website");
    assert.match(signed, />Facebook<\/a>/);
    assert.match(signed, /Glenelg: 1 Jetty Rd/);
    const business = renderEmailHtml(branded, email.body, { cta: email.cta });
    assert.match(business, /<img src="https:\/\/coastline.example\/logo.png" width="88"/, "the business signs with its logo");
    assert.doesNotMatch(business, /Dana/);
    assert.equal(templates.acknowledgementSms({ tenant: fresh, firstName: null, bookingUrl: "https://x/y", topic: null, signedBy: "http://evil" }).includes("evil"), false, "a bad name is dropped, not sent");
  });

  it("the acknowledgement goes out signed by the assignee, with replies to them", async () => {
    const { runGreenLeadPlaybook } = await import("@/lib/playbook");
    const dana = (await repository.listTenantPeople(fresh.id)).find((p) => p.via === "member")!;
    const result = await processIntake(fresh, intakeSchema.parse({ source: "WEB_FORM", firstName: "Priya", email: "priya@example.com", phone: "+61400111222", message: "I would like a sales appraisal of my home in Glenelg, I am the owner." }), {});
    assert.ok(result.outcome === "created" && result.lead.ticketType === "GREEN", `green lead expected, got ${result.outcome}`);
    await repository.assignLead(fresh.id, result.lead.id, dana.userId);
    const lead = (await repository.findLeadById(fresh.id, result.lead.id))!;
    assert.equal(lead.assigneeId, dana.userId);
    // The log provider prints the first 120 characters of every send; that is enough to see who signed it.
    const logged: string[] = [];
    const original = console.info;
    console.info = (...args: unknown[]) => logged.push(args.map(String).join(" "));
    try {
      await runGreenLeadPlaybook(fresh, lead);
    } finally {
      console.info = original;
    }
    const ack = logged.find((l) => /priya@example\.com/.test(l) && /Thank you for getting in touch/.test(l));
    assert.ok(ack, `acknowledgement email logged: ${logged.slice(-3).join(" | ")}`);
    assert.match(ack!, /and Dana will be/);
    const runs = await repository.listAutomationRuns(fresh.id, 10);
    assert.ok(runs.some((r) => r.typeKey === "enquiry_auto_reply" && r.outcome === "SENT" && /Acknowledged Priya/.test(r.summary)), "acknowledgement logged as sent");
  });
});

describe("listings sync from property management software", () => {
  it("pulls the rent roll through the provider, upserts it, and records what it did", async () => {
    process.env.INVENTORY_MODE = "log";
    const { connectInventoryVendor, loadInventoryConnection, runInventorySync } = await import("@/lib/inventory/sync");
    assert.equal((await runInventorySync(fresh)).skipped, "no property management software connected");
    await connectInventoryVendor(fresh.id, "propertyme", { accessToken: "test-token", refreshToken: "r", clientId: "c", clientSecret: "s" }, { label: "PropertyMe" });
    const connection = await loadInventoryConnection(fresh.id);
    assert.equal(connection?.vendor, "propertyme");
    assert.equal(connection?.creds.accessToken, "test-token", "token round-trips through encryption");
    assert.equal((await repository.getTenantConfig(fresh.id)).integrations.find((i) => i.provider === "PROPERTY_MANAGEMENT")?.status, "CONNECTED");
    const first = await runInventorySync(fresh);
    assert.deepEqual(first, { created: 2, updated: 0, skipped: null });
    const again = await runInventorySync(fresh);
    assert.equal(again.created, 0);
    const items = await repository.listInventory(fresh.id);
    const harbour = items.find((i) => i.externalId === "log-lot-1");
    assert.ok(harbour && harbour.status === "ACTIVE" && harbour.source === "propertyme" && harbour.attributes.rentPerWeekCents === 65_000);
    assert.equal(items.find((i) => i.externalId === "log-lot-2")?.status, "UNAVAILABLE");
    const runs = await repository.listAutomationRuns(fresh.id, 10);
    assert.ok(runs.some((r) => r.typeKey === "inventory_sync" && r.outcome === "COMPLETED" && /2 listings from propertyme/.test(r.summary)), "sync run recorded");
    assert.equal((await findListingMentioned(fresh.id, "is 7 harbour view terrace still available?"))?.externalId, "log-lot-1", "synced listings answer enquiries");
    assert.equal((await repository.listInventory(harbor.id)).some((i) => i.externalId === "log-lot-1"), false, "isolated");
    await repository.setAutomation(fresh.id, "inventory_sync", { enabled: false });
    assert.equal((await runInventorySync(fresh)).skipped, "listings sync off");
  });
});

describe("Phase 5 follow-up: enquiries answered with the area, bedrooms and real listings", () => {
  it("reads what a renter asked for with fixed patterns only", async () => {
    const { listingNeeds, suburbFromAddress } = await import("@/lib/inventory");
    const { safeArea } = await import("@/lib/messaging/templates");
    assert.deepEqual(listingNeeds("Do you have any 3 bedroom rentals in Blair Athol?"), { bedrooms: 3, rental: true, inspection: false });
    assert.deepEqual(listingNeeds("two-bed unit to lease"), { bedrooms: 2, rental: true, inspection: false });
    assert.deepEqual(listingNeeds("Can I inspect 4 Smith St"), { bedrooms: null, rental: false, inspection: true });
    assert.equal(safeArea("looking in blair athol please", ["Blair Athol", "Mount Gambier"]), "Blair Athol");
    assert.equal(safeArea("Mount Gambier-ish", ["Blair Athol", "Mount Gambier"]), "Mount Gambier");
    assert.equal(safeArea("Blairathol", ["Blair Athol"]), null, "needs the whole place name");
    assert.equal(safeArea("<b>Prospect</b> http://evil", ["Blair Athol"]), null, "only tenant-listed areas are echoed");
    assert.equal(suburbFromAddress("6B East Way, Darlington SA 5047"), "Darlington");
    assert.equal(suburbFromAddress("1 Gardiner Terrace, Mount Gambier, SA, 5290"), "Mount Gambier");
    assert.equal(suburbFromAddress("13 Sutton Rd"), null);
  });

  it("imports a rent roll with manager, type and suburb, and offers the available properties that fit", async () => {
    const { csvToInventory, importInventory, findListingsMatching, describeListing } = await import("@/lib/inventory");
    const csv = [
      "address,suburb,bedrooms,bathrooms,car,property_type,manager,status",
      "\"1 Eldorado St, Munno Para West SA 5115\",,3,1,1,House,Marissa Bowell,leased",
      "\"477 Prospect Rd, Blair Athol SA 5084\",,3,1,2,House,Luke Whittaker,available",
      "\"2/9 Gray St, Blair Athol SA 5084\",,2,1,1,Unit,Luke Whittaker,available",
      "\"10 Franklin Terrace\",Blair Athol,4,2,2,House,Luke Whittaker,available",
    ].join("\n");
    const parsed = csvToInventory(csv);
    assert.equal(parsed.items.length, 4);
    assert.deepEqual(parsed.items[0]!.attributes, { bedrooms: 3, bathrooms: 1, manager: "Marissa Bowell", propertyType: "House", carSpaces: 1, suburb: "Munno Para West" });
    assert.equal(parsed.items[0]!.status, "UNAVAILABLE");
    assert.equal(parsed.items[3]?.attributes?.suburb, "Blair Athol", "an explicit suburb column wins");
    await importInventory(fresh, parsed.items, "propertyme-export");
    const threes = await findListingsMatching(fresh.id, { suburb: "Blair Athol", bedrooms: 3 });
    assert.deepEqual(threes.map((i) => i.name), ["477 Prospect Rd, Blair Athol SA 5084"], "exact bedroom match in the suburb, leased ones excluded");
    const fives = await findListingsMatching(fresh.id, { suburb: "Blair Athol", bedrooms: 5 });
    assert.deepEqual(fives, [], "nothing bigger than what is there");
    const twos = await findListingsMatching(fresh.id, { suburb: "blair athol", bedrooms: 2 });
    assert.deepEqual(twos.map((i) => i.name), ["2/9 Gray St, Blair Athol SA 5084"]);
    const any = await findListingsMatching(fresh.id, { suburb: "Blair Athol" });
    assert.equal(any.length, 3);
    assert.equal(describeListing(threes[0]!, "en-AU", "AUD"), "477 Prospect Rd, Blair Athol SA 5084 · 3 beds", "suburb not repeated when the address carries it");
    assert.equal(await findListingsMatching(fresh.id, { suburb: "Nowhere", bedrooms: 3 }).then((r) => r.length), 0);
  });

  it("writes the reply around the listings and a button, signed by the person", async () => {
    const { templates } = await import("@/lib/messaging");
    const reply = templates.generalReply({ tenant: fresh, firstName: "Sam", channel: "EMAIL", custom: null, infoUrl: null, topic: "rentals", area: "Blair Athol", listings: ["477 Prospect Rd, Blair Athol SA 5084 · 3 beds", "2/9 Gray St, Blair Athol SA 5084 · 2 beds"], signedBy: "Luke" });
    assert.match(reply.body, /about rentals in Blair Athol\. Here is what we have at the moment that may suit:\n\n• 477 Prospect Rd[^\n]*\n• 2\/9 Gray St[^\n]*\n\nLuke will confirm availability and inspection times with you\./);
    assert.equal(reply.cta, null);
    const sms = templates.generalReply({ tenant: fresh, firstName: "Sam", channel: "SMS", custom: null, infoUrl: "https://coastline.example/rentals", topic: "rentals", area: null, listings: [] });
    assert.match(sms.body, /^Hi Sam, thanks for your message to Coastline Property Group about rentals\. The quickest way/);
    const ack = templates.acknowledgementEmail({ tenant: fresh, firstName: "Sam", bookingUrl: "https://book.example/x", topic: "an appraisal", area: "Glenelg", signedBy: "Dana" });
    assert.match(ack.body, /^Hi Sam,\n\nThank you for getting in touch with Coastline Property Group about an appraisal in Glenelg\. We've received your message and Dana will be in contact soon\.\n\nIf you'd like to choose a time now, you can book here: https:\/\/book\.example\/x\n\n/);
    assert.match(ack.body, /Kind regards,\nDana, Coastline Property\nCoastline Property Co \| RLA 000001\n\nThis is an automated message from Dana at Coastline Property Group\./);
    assert.deepEqual(ack.cta, { label: "Book a time", url: "https://book.example/x" });
  });
});
