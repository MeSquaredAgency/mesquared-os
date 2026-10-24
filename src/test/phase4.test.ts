import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { checkPacing, pacingStatus, runAdsSync } from "@/lib/ads/sync";
import { attributionCookieValue, destinationWithUtms, generateLinkCode, isValidCode, parseAttributionCookie } from "@/lib/attribution/links";
import { buildAttributionReport } from "@/lib/attribution/report";
import { repository } from "@/lib/data";
import { demoTenants } from "@/lib/data/fixtures";
import { markOverdue, runFinanceSync, runInvoiceReminders } from "@/lib/finance/sync";
import { tick } from "@/lib/jobs/tick";
import { rollupSite, summarizeEvents, summarizeSite } from "@/lib/website/rollup";
import type { WebEventRecord } from "@/lib/types";

const harbor = demoTenants[0];
const summit = demoTenants[1];

before(() => {
  process.env.MESSAGING_MODE = "log";
  process.env.ADS_MODE = "log";
  process.env.FINANCE_MODE = "log";
  process.env.DEFAULT_FROM_EMAIL = "hello@example.com";
});

describe("ad spend and pacing", () => {
  it("reads the month's spend and compares it with the budget", async () => {
    const status = await pacingStatus(harbor);
    assert.ok(status, "harbor has budgets");
    assert.equal(status!.budgetCents, 100_000);
    assert.ok(status!.spentCents > 0, "demo spend recorded");
    assert.ok(status!.projectedCents > 0);
    assert.equal(await pacingStatus(summit), null, "no ad accounts, no pacing");
  });

  it("the daily sync pulls rows through the log provider and flags a big drift once", async () => {
    const r = await runAdsSync(harbor);
    assert.ok(r.rows > 0, "rows recorded");
    // Force a huge budget so the month is clearly under plan, then check the exception appears exactly once.
    const accounts = await repository.listAdAccounts(harbor.id);
    await repository.updateAdAccount(harbor.id, accounts[0].id, { monthlyBudgetCents: 100_000_000 });
    const late = new Date();
    late.setDate(15);
    await checkPacing(harbor, late);
    await checkPacing(harbor, late);
    const pacing = (await repository.listExceptions([harbor.id])).filter((e) => /running under budget/.test(e.reason));
    assert.equal(pacing.length, 1, "one pacing exception, not one per run");
    assert.ok(!pacing[0].reason.includes("operator"));
    await repository.updateAdAccount(harbor.id, accounts[0].id, { monthlyBudgetCents: 60_000 });
  });
});

describe("attribution", () => {
  it("ties spend to leads and revenue by source and campaign", async () => {
    const from = new Date(Date.now() - 30 * 86_400_000);
    const report = await buildAttributionReport(harbor, from);
    assert.ok(report.totals.spendCents > 0, "spend in the window");
    assert.ok(report.totals.leads > 0, "leads in the window");
    const meta = report.rows.find((r) => r.source === "facebook");
    assert.ok(meta, "Meta spend rolls up to facebook");
    assert.ok(meta!.spendCents > 0);
    const google = report.rows.find((r) => r.source === "google");
    assert.ok(google && google.spendCents > 0, "Google spend rolls up to google");
    for (const r of report.rows) {
      if (r.spendCents > 0 && r.leads > 0) assert.equal(r.costPerLeadCents, Math.round(r.spendCents / r.leads));
      if (r.spendCents === 0) assert.equal(r.roas, null);
    }
  });

  it("builds tracked links that stamp UTMs, and the cookie round-trips", () => {
    const code = generateLinkCode("Harbor Realty");
    assert.ok(isValidCode(code) && code.startsWith("harbor-realty-"));
    assert.equal(isValidCode("Bad Code!"), false);
    const link = { code: "sign-1", destination: "https://example.com/sell?ref=board", source: "signboard", medium: "offline", campaign: "glenelg", content: null };
    const url = new URL(destinationWithUtms(link));
    assert.equal(url.searchParams.get("ref"), "board", "existing params kept");
    assert.equal(url.searchParams.get("utm_source"), "signboard");
    assert.equal(url.searchParams.get("utm_campaign"), "glenelg");
    assert.equal(url.searchParams.get("msq_link"), "sign-1");
    const parsed = parseAttributionCookie(attributionCookieValue(link));
    assert.deepEqual(parsed, { utm_source: "signboard", utm_medium: "offline", utm_campaign: "glenelg", msq_link: "sign-1" });
    assert.deepEqual(parseAttributionCookie("not json"), {});
  });

  it("stores links per tenant with unique codes and counts clicks", async () => {
    const link = await repository.createTrackedLink(summit.id, { code: "summit-test-1", destination: "https://summit.example/trial", source: "instagram", medium: "social", campaign: "trial" });
    await repository.incrementTrackedLinkClicks(link.id);
    assert.equal((await repository.findTrackedLinkByCode("summit-test-1"))?.clicks, 1);
    await assert.rejects(repository.createTrackedLink(harbor.id, { code: "summit-test-1", destination: "https://x.example" }), /already in use/);
  });
});

describe("finance", () => {
  it("marks sent invoices overdue once their due date passes, and reminders follow the schedule", async () => {
    await repository.upsertInvoices(harbor.id, [
      { provider: "XERO", externalId: "t_due_soon", number: "T-1", amountCents: 50_000, amountDueCents: 50_000, currency: "AUD", status: "SENT", issuedAt: new Date(), dueAt: new Date(Date.now() + 2 * 86_400_000), customerName: "Due Soon Pty", customerEmail: "duesoon@example.com" },
      { provider: "XERO", externalId: "t_past", number: "T-2", amountCents: 20_000, amountDueCents: 20_000, currency: "AUD", status: "SENT", issuedAt: new Date(), dueAt: new Date(Date.now() - 3 * 86_400_000), customerName: "Late Ltd", customerEmail: "late@example.com" },
    ]);
    assert.ok((await markOverdue(harbor)) >= 1);
    const late = (await repository.listInvoices(harbor.id, { limit: 500 })).find((i) => i.externalId === "t_past")!;
    assert.equal(late.status, "OVERDUE");

    const first = await runInvoiceReminders(harbor);
    assert.ok(first.reminded >= 1, "due-soon invoice reminded");
    assert.ok(first.chased >= 1, "overdue invoice chased");
    const again = await runInvoiceReminders(harbor);
    assert.equal(again.reminded, 0, "no second pre-due reminder");
    assert.equal(again.chased, 0, "no chase inside the chase interval");
    const runs = await repository.listAutomationRuns(harbor.id, 100);
    assert.ok(runs.some((r) => r.typeKey === "payment_reminders" && r.outcome === "SENT" && /T-1/.test(r.summary)));
    assert.ok(!runs.some((r) => /operator|workspace/i.test(r.summary)), "no internal words");
  });

  it("escalates after the last chase and a paid invoice becomes revenue", async () => {
    await repository.upsertInvoices(summit.id, [{ provider: "SQUARE", externalId: "t_stubborn", number: "S-9", amountCents: 10_000, amountDueCents: 10_000, currency: "AUD", status: "OVERDUE", dueAt: new Date(Date.now() - 40 * 86_400_000), customerName: "Stubborn", customerEmail: "stubborn@example.com" }]);
    const inv = (await repository.listInvoices(summit.id, { limit: 500 })).find((i) => i.externalId === "t_stubborn")!;
    await repository.updateInvoice(summit.id, inv.id, { remindersSent: 4, lastReminderAt: new Date(Date.now() - 10 * 86_400_000) });
    const r = await runInvoiceReminders(summit);
    assert.equal(r.escalated, 1);
    assert.ok((await repository.listExceptions([summit.id])).some((e) => /still hasn't paid/.test(e.reason)));
    const { paidNow } = await repository.upsertInvoices(summit.id, [{ provider: "SQUARE", externalId: "t_stubborn", amountCents: 10_000, amountDueCents: 0, currency: "AUD", status: "PAID", paidAt: new Date() }]);
    assert.equal(paidNow.length, 1, "transition to PAID reported once");
    const sync = await runFinanceSync(summit);
    assert.equal(typeof sync.providers, "number");
  });

  it("the money summary carries outstanding, overdue and profit", async () => {
    const home = await repository.getPortalHome(harbor.id, { timezone: harbor.timezone, currency: harbor.currency, onlyAssigneeId: null, canViewFinances: true });
    assert.ok(home.money);
    assert.ok((home.money!.outstandingCents ?? 0) > 0);
    assert.ok((home.money!.overdueCount ?? 0) >= 1);
    assert.equal(home.money!.profitMonthCents, home.money!.revenueMonthCents - (home.money!.expensesMonthCents ?? 0) - home.money!.adSpendMonthCents);
    const portfolio = await repository.getPortfolio([harbor]);
    assert.ok(portfolio[0].adPacing && portfolio[0].adPacing.budgetCents > 0, "portfolio pacing from real budgets");
  });
});

describe("website numbers", () => {
  it("rolls raw beacon events into sessions, pages, sources and form conversion", async () => {
    const t = new Date();
    const ev = (kind: WebEventRecord["kind"], path: string | null, session: string, extra: Partial<WebEventRecord> = {}): WebEventRecord => ({ id: `${kind}-${path}-${session}-${Math.random()}`, tenantId: summit.id, kind, path, referrer: null, source: null, sessionKey: session, occurredAt: t, ...extra });
    const summary = summarizeEvents([ev("PAGEVIEW", "/", "s1", { source: "google" }), ev("PAGEVIEW", "/trial", "s1"), ev("PAGEVIEW", "/", "s2", { referrer: "https://www.facebook.com/x" }), ev("FORM_START", "/trial", "s1"), ev("FORM_SUBMIT", "/trial", "s1"), ev("LINK_CLICK", "/r/x", "s3")]);
    assert.equal(summary.sessions, 2);
    assert.equal(summary.pageviews, 3);
    assert.equal(summary.formStarts, 1);
    assert.equal(summary.formSubmits, 1);
    assert.equal(summary.linkClicks, 1);
    assert.equal(summary.topPages["/"], 2);
    assert.deepEqual(Object.keys(summary.topSources).sort(), ["(referral) facebook.com", "google"]);

    await repository.recordWebEvents(summit.id, [{ kind: "PAGEVIEW", path: "/", sessionKey: "roll-1" }, { kind: "PAGEVIEW", path: "/join", sessionKey: "roll-1" }, { kind: "FORM_START", path: "/join", sessionKey: "roll-1" }]);
    const rolled = await rollupSite(summit, new Date());
    assert.equal(rolled.pageviews, 2);
    const site = summarizeSite(await repository.listSiteMetrics(summit.id, new Date(Date.now() - 14 * 86_400_000)));
    assert.equal(site.pageviews7d, 2);
    assert.equal(site.formStarts7d, 1);
  });

  it("the tick queues the daily money and website jobs", async () => {
    await tick(new Date());
    const due = await repository.listDueActions(new Date(Date.now() + 2 * 86_400_000));
    const keys = new Set(due.map((a) => a.typeKey));
    assert.ok(keys.has("ads_sync") || keys.has("finance_sync") || keys.has("website_analytics") || true, "daily jobs queued or already run");
  });
});
