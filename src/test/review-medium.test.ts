import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { registerAutomations } from "@/lib/automations/handlers";
import { repository } from "@/lib/data";
import { demoTenants } from "@/lib/data/fixtures";
import { csvToInventory, findListingMentioned, findListingsMatching, importInventory, normaliseAddress } from "@/lib/inventory";
import { tick } from "@/lib/jobs/tick";
import { quietHoursEnd, sendMessage, templates } from "@/lib/messaging";
import { safeAreas } from "@/lib/messaging/templates";
import { provisionTenant } from "@/lib/tenants/provision";
import type { TenantSummary } from "@/lib/types";
import { startOfDayInZone } from "@/lib/utils";

/**
 * Regression tests for the medium-priority findings of the pre-launch review
 * (docs/reviews/2026-10-25-pre-launch-review.md).
 */

const harbor = demoTenants[0];
let fresh: TenantSummary;

/** A tenant whose quiet hours cover this very moment (or do not), without depending on the wall clock. */
function withQuietHoursNow(tenant: TenantSummary, quietNow: boolean): TenantSummary {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, hour: "numeric", hour12: false }).format(new Date())) % 24;
  const start = quietNow ? (hour + 23) % 24 : (hour + 2) % 24;
  const end = quietNow ? (hour + 2) % 24 : (hour + 3) % 24;
  return { ...tenant, sla: { ...tenant.sla, quietHours: { start, end } } };
}

before(async () => {
  process.env.MESSAGING_MODE = "log";
  process.env.DEFAULT_FROM_EMAIL ??= "hello@platform.example";
  registerAutomations();
  fresh = await provisionTenant({ templateKey: "real_estate", name: "Seaside Property Co", slug: "seaside-review-medium", region: "au", timezone: "Australia/Adelaide", locale: "en-AU", currency: "aud", fromName: "Seaside", replyTo: "office@seaside.example", serviceAreas: ["Glenelg", "Darlington"], requiredFooter: "Seaside Property Co | RLA 000002" });
  const csv = [
    "address,suburb,bedrooms,manager,status",
    "\"12 Smith Street, Darlington SA 5047\",,3,Luke Whittaker,available",
    "\"4 Darlington Road, Mitcham SA 5062\",,2,Brett David,available",
    "\"8 Jetty Rd, Glenelg SA 5045\",,2,Luke Whittaker,available",
    "\"9 Jetty Rd, Glenelg SA 5045\",,2,Marissa Bowell,available",
  ].join("\n");
  await importInventory(fresh, csvToInventory(csv).items, "test");
});

describe("medium: listings are matched by what the enquiry actually says", () => {
  it("normalises addresses so portal wording matches the rent roll", () => {
    assert.equal(normaliseAddress("12 Smith Street, Darlington SA 5047"), "12 smith st darlington");
    assert.equal(normaliseAddress("12 smith st, darlington"), "12 smith st darlington");
    assert.equal(normaliseAddress("Unit 3/45 The Esplanade, Glenelg"), "unit 3/45 the esp glenelg");
  });

  it("finds the listing an REA-style enquiry names, and nothing when no listing is named", async () => {
    const hit = await findListingMentioned(fresh.id, "Hi, I'm enquiring about 12 Smith Street, Darlington. Is it still available?");
    assert.equal(hit?.name, "12 Smith Street, Darlington SA 5047");
    assert.equal(await findListingMentioned(fresh.id, "Anything in Darlington with 3 beds?"), null, "a suburb alone is not a listing mention");
    assert.equal(await findListingMentioned(fresh.id, "12 Smith"), null, "too short to be an address");
  });

  it("matches on the suburb attribute, so a Darlington Road in Mitcham is not offered for Darlington", async () => {
    const names = (await findListingsMatching(fresh.id, { suburb: "Darlington" })).map((i) => i.name);
    assert.deepEqual(names, ["12 Smith Street, Darlington SA 5047"]);
  });

  it("names every service area mentioned, so two of them mean a generic reply", () => {
    assert.deepEqual(safeAreas("I live in Glenelg and need a 2 bed in Darlington", ["Glenelg", "Darlington"]), ["Glenelg", "Darlington"]);
    assert.deepEqual(safeAreas("2 bed in darlington please", ["Glenelg", "Darlington"]), ["Darlington"]);
    assert.deepEqual(safeAreas("anything", ["Glenelg"]), []);
  });
});

describe("medium: texts stay cheap", () => {
  it("uses plain punctuation and at most two listings on SMS, all of them on email", () => {
    const listings = ["8 Jetty Rd, Glenelg SA 5045 · 2 beds", "9 Jetty Rd, Glenelg SA 5045 · 2 beds", "1 Other St, Glenelg SA 5045 · 2 beds"];
    const sms = templates.generalReply({ tenant: fresh, firstName: "Sam", channel: "SMS", custom: null, infoUrl: null, topic: "rentals", area: "Glenelg", listings });
    assert.doesNotMatch(sms.body, /[•·]/, "no characters outside GSM-7");
    assert.match(sms.body, /- 8 Jetty Rd, Glenelg SA 5045, 2 beds - 9 Jetty Rd/);
    assert.doesNotMatch(sms.body, /1 Other St/, "capped at two on a text");
    const email = templates.generalReply({ tenant: fresh, firstName: "Sam", channel: "EMAIL", custom: null, infoUrl: null, topic: "rentals", area: "Glenelg", listings });
    assert.match(email.body, /• 1 Other St/, "email lists all three");
  });
});

describe("medium: a message held for quiet hours keeps its identity", () => {
  it("queues the reply-to, button and signature with the body, under a key that includes the release time", async () => {
    const quiet = withQuietHoursNow(harbor, true);
    const contact = await repository.upsertContact(harbor.id, { firstName: "Held", lastName: null, email: "held-medium@example.com", phone: null, company: null });
    await repository.setContactConsent(harbor.id, contact.id, "email", true, "test");
    const signature = { name: "Dana Reyes", title: "Property Manager", phone: null, email: "dana@harbor.example", photoUrl: null };
    const r = await sendMessage({ tenant: quiet, contactId: contact.id, channel: "EMAIL", to: contact.email!, body: "A quick hello. Book here: https://x/y", subject: "Hello", transactional: false, replyTo: "dana@harbor.example", cta: { label: "Book", url: "https://x/y" }, signature });
    assert.equal(r.held, true);
    const releaseAt = quietHoursEnd(quiet);
    const due = await repository.listDueActions(new Date(releaseAt.getTime() + 1000), 200);
    const action = due.find((a) => a.typeKey === "messaging" && a.action === "release" && a.payload.to === contact.email);
    assert.ok(action, "the hold is queued");
    assert.equal(action.payload.replyTo, "dana@harbor.example");
    assert.deepEqual(action.payload.cta, { label: "Book", url: "https://x/y" });
    assert.deepEqual(action.payload.signature, signature);
    assert.match(action.dedupeKey, new RegExp(`:${releaseAt.getTime()}$`), "keyed by release time");
  });
});

describe("medium: daily jobs run after quiet hours end today", () => {
  it("schedules the content batch for this morning's quiet-hours end, not midnight", async () => {
    const config = await repository.getTenantConfig(fresh.id);
    void config;
    // 02:30 local in Adelaide on 15 Jan 2026 (ACDT): before quiet hours end at 08:00, so the batch waits for 08:00.
    const now = new Date("2026-01-14T16:00:00Z");
    await tick(now);
    const morning = quietHoursEnd(fresh, startOfDayInZone(fresh.timezone, now));
    const batch = (await repository.listDueActions(new Date(morning.getTime() + 60_000), 500)).find((a) => a.tenantId === fresh.id && a.typeKey === "content_engine" && a.action === "batch");
    assert.ok(batch, "a batch is queued for today");
    assert.equal(batch.runAt.toISOString(), morning.toISOString());
    assert.ok(batch.runAt.getTime() > now.getTime(), "not before the morning");
  });
});

describe("medium: money and SLA scans", () => {
  it("counts ad spend only in the panel's currency", async () => {
    const accounts = await repository.listAdAccounts(harbor.id);
    assert.ok(accounts.length > 0, "demo tenant has ad accounts");
    const all = await repository.sumAdSpend(harbor.id, new Date(0));
    const aud = await repository.sumAdSpend(harbor.id, new Date(0), undefined, "AUD");
    const chf = await repository.sumAdSpend(harbor.id, new Date(0), undefined, "CHF");
    assert.ok(aud <= all);
    assert.equal(chf, 0, "a currency no account is billed in contributes nothing");
    assert.equal(await repository.countLeadsPastSla(harbor.id, new Date()), (await repository.listLeadsPastSla(harbor.id, new Date())).respond.length + (await repository.listLeadsPastSla(harbor.id, new Date())).book.length);
  });
});
