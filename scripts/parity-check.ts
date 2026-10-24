/**
 * Runs the real flows against whatever DATABASE_URL points at, so the Prisma
 * repository is exercised the way the in-memory one is by the unit tests.
 * Prints a pass/fail line per step and exits non-zero on any failure.
 *
 *   DATABASE_URL=... MESSAGING_MODE=log npm run db:parity
 */
import assert from "node:assert/strict";
import { registerAutomations, onBookingCreated, runScheduledAction } from "@/lib/automations/handlers";
import { dataMode, repository } from "@/lib/data";
import { emit } from "@/lib/events";
import { processIntake } from "@/lib/intake/process";
import { intakeSchema } from "@/lib/intake/schema";
import { tick } from "@/lib/jobs/tick";
import { detectForTenant } from "@/lib/opportunities/detect";
import { registerPlaybook } from "@/lib/playbook";
import { generateFromSource, ingestSource, scheduleApproved } from "@/lib/content/engine";
import { ingestInboxItems, replyToConversation } from "@/lib/social/inbox";
import { publishDuePosts } from "@/lib/social/publish";
import { pacingStatus, runAdsSync } from "@/lib/ads/sync";
import { buildAttributionReport } from "@/lib/attribution/report";
import { markOverdue, runInvoiceReminders } from "@/lib/finance/sync";
import { rollupSite } from "@/lib/website/rollup";
import { hashApiKey } from "@/lib/crypto";
import { csvToInventory, findListingMentioned, importInventory, registerInventory } from "@/lib/inventory";
import { readinessSummary, tenantReadiness } from "@/lib/launch/readiness";
import { inviteMember, issueApiKey, provisionTenant } from "@/lib/tenants/provision";

process.env.MESSAGING_MODE ??= "log";
process.env.DEFAULT_FROM_EMAIL ??= "hello@example.com";
registerPlaybook();
registerAutomations();

let failures = 0;
async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures++;
    console.log(`  FAIL ${name}\n       ${error instanceof Error ? error.message : error}`);
  }
}

console.log(`Parity check against ${dataMode} repository`);
assert.equal(dataMode, "postgres", "DATABASE_URL must be set for the parity check");

const tenants = await repository.listAllTenants();
const harbor = tenants.find((t) => t.templateKey === "real_estate");
const summit = tenants.find((t) => t.templateKey === "health_fitness");
assert.ok(harbor && summit, "seeded tenants present");
const stamp = Date.now().toString(36);
// A per-run phone number so contact dedupe (24h window on phone/email) does not collapse runs into each other.
const phone = "+6140" + String(Date.now()).slice(-7);

await step("tenant config applied from template (roles, pipelines, modules, automations, brand)", async () => {
  const cfg = await repository.getTenantConfig(harbor!.id);
  assert.deepEqual(cfg.roles.map((r) => r.name).sort(), ["Director", "External accountant", "Property Manager", "Region Manager"]);
  assert.ok(cfg.pipelines.find((p) => p.isDefault)?.stages.length === 6);
  assert.ok(cfg.pipelines.flatMap((p) => p.stages).some((s) => s.quietAfterDays === 4));
  assert.ok(cfg.automations.find((a) => a.typeKey === "sla_watch")?.enabled);
  assert.ok(cfg.brand?.complianceBlock);
});

await step("access: owner member sees permissions; operator assignment; admin sees all", async () => {
  const owner = await repository.findUserByEmail(`owner@${harbor!.slug}.example`);
  assert.ok(owner);
  const access = await repository.listTenantAccess(owner!.user.id);
  assert.equal(access.length, 1);
  assert.equal(access[0].via, "member");
  assert.ok(access[0].permissions.includes("VIEW_FINANCES"));
  const ops = await repository.findUserByEmail("ops@example.com");
  assert.equal((await repository.listTenantAccess(ops!.user.id)).every((a) => a.via === "operator"), true);
  const admin = await repository.findUserByEmail("operator@example.com");
  assert.equal((await repository.listTenantAccess(admin!.user.id)).length, tenants.length);
});

let greenLeadId = "";
await step("intake: green lead → contact, pipeline, SLA deadlines, playbook (acknowledgement, alert), events", async () => {
  const body = intakeSchema.parse({ source: "META_LEAD_FORM", externalId: `parity_green_${stamp}`, name: "Parity Owner", email: `parity-${stamp}@example.com`, phone, message: "I own a unit in Adelaide and want an appraisal and management.", fields: { utm_source: "facebook", utm_campaign: "parity" } });
  const r = await processIntake(harbor!, body, { parity: true });
  assert.equal(r.outcome, "created");
  if (r.outcome !== "created") return;
  greenLeadId = r.lead.id;
  assert.equal(r.qualification.ticketType, "GREEN");
  assert.equal(r.lead.phone, phone);
  assert.ok(r.lead.contactId && r.lead.pipelineId && r.lead.stageId && r.lead.respondBy && r.lead.bookBy);
  const lead = await repository.findLeadById(harbor!.id, r.lead.id);
  assert.ok(lead?.firstResponseAt, "acknowledged");
  assert.equal(lead?.status, "BOOKING_SENT");
  const runs = await repository.listAutomationRuns(harbor!.id, 20);
  assert.ok(runs.some((x) => x.leadId === r.lead.id && /Acknowledged/.test(x.summary)));
  const events = await repository.listEvents(harbor!.id, 20);
  assert.ok(events.some((e) => e.type === "lead.qualified"));
});

await step("intake: duplicate externalId and contact dedupe; red lead handled", async () => {
  const dup = await processIntake(harbor!, intakeSchema.parse({ externalId: `parity_green_${stamp}`, email: "x@example.com" }), {});
  assert.equal(dup.outcome, "duplicate");
  const red = await processIntake(harbor!, intakeSchema.parse({ source: "PORTAL_EMAIL", externalId: `parity_red_${stamp}`, email: `renter-${stamp}@example.com`, message: "Is the unit still available? When is the next inspection?" }), {});
  assert.equal(red.outcome, "created");
  if (red.outcome === "created") assert.equal(red.qualification.ticketType, "RED");
});

await step("tenant isolation: no cross-tenant writes", async () => {
  await assert.rejects(repository.createBooking(summit!.id, { leadId: greenLeadId, bookingUrl: "x", sent: false }));
  await assert.rejects(repository.recordAutomationRun(summit!.id, { typeKey: "x", outcome: "SENT", summary: "x", leadId: greenLeadId }));
});

await step("bookings: schedule, confirm, remind, auto-complete, follow-up, review request", async () => {
  const lead = await repository.findLeadById(harbor!.id, greenLeadId);
  const existing = await repository.findLatestBookingForLead(harbor!.id, greenLeadId);
  assert.ok(lead && existing);
  const startsAt = new Date(Date.now() + 2 * 86_400_000);
  const endsAt = new Date(startsAt.getTime() + 3_600_000);
  const booking = await repository.updateBooking(harbor!.id, existing!.id, { status: "SCHEDULED", startsAt, endsAt, externalId: `cal_${stamp}` });
  await repository.markLeadBooked(harbor!.id, lead!.id, startsAt);
  assert.equal((await repository.findLeadById(harbor!.id, lead!.id))?.status, "BOOKED");
  await onBookingCreated(harbor!, lead!, booking!.id, startsAt, endsAt);
  const reminder = (await repository.listDueActions(new Date(startsAt.getTime() - 23 * 3_600_000))).find((a) => a.action === "reminder" && a.payload.bookingId === booking!.id);
  assert.ok(reminder, "reminder scheduled");
  await runScheduledAction(reminder!);
  await repository.completeAction(reminder!.id, "DONE");
  const auto = (await repository.listDueActions(new Date(endsAt.getTime() + 3 * 3_600_000))).find((a) => a.action === "auto_complete" && a.payload.bookingId === booking!.id);
  await runScheduledAction(auto!);
  await repository.completeAction(auto!.id, "DONE");
  assert.equal((await repository.findBookingById(harbor!.id, booking!.id))?.status, "COMPLETED");
  const queued = await repository.listDueActions(new Date(Date.now() + 3 * 86_400_000));
  assert.ok(queued.some((a) => a.action === "follow_up" && a.payload.bookingId === booking!.id && a.payload.uncertain === true), "neutral follow-up after an unconfirmed appointment");
  assert.ok(!queued.some((a) => a.typeKey === "review_request" && a.payload.bookingId === booking!.id), "no review ask until a person confirms attendance");
  await emit(harbor!.id, "booking.completed", { bookingId: booking!.id, leadId: lead!.id, by: "operator" });
  const afterConfirm = await repository.listDueActions(new Date(Date.now() + 3 * 86_400_000));
  assert.ok(afterConfirm.some((a) => a.typeKey === "review_request" && a.payload.bookingId === booking!.id), "review ask queued after explicit completion");
  // Claim semantics on Postgres: the same row cannot be claimed twice.
  const claimable = afterConfirm.find((a) => a.typeKey === "review_request" && a.payload.bookingId === booking!.id)!;
  assert.equal(await repository.claimAction(claimable.id, new Date(), 600_000), true);
  assert.equal(await repository.claimAction(claimable.id, new Date(), 600_000), false);
  await repository.completeAction(claimable.id, "CANCELLED");
});

await step("detectors + missed opportunities: raise once, dedupe, exception, escalation", async () => {
  await repository.upsertReview(harbor!.id, { provider: "Google", externalId: `g_${stamp}`, authorName: "Parity Reviewer", rating: 3, body: "ok", url: null, receivedAt: new Date(Date.now() - 5 * 86_400_000) });
  const first = await detectForTenant(harbor!);
  assert.ok(first.detected.some((d) => d.type === "UNANSWERED_REVIEW"));
  const second = await detectForTenant(harbor!);
  assert.equal(second.detected.filter((d) => d.type === "UNANSWERED_REVIEW").length, 0);
  const ex = await repository.listExceptions([harbor!.id]);
  assert.ok(ex.some((e) => /review/.test(e.reason)));
});

await step("scheduler tick runs across tenants", async () => {
  const result = await tick();
  assert.equal(result.tenants, tenants.length);
});

await step("read models: portal home (money gated) and portfolio", async () => {
  const home = await repository.getPortalHome(harbor!.id, { timezone: harbor!.timezone, currency: harbor!.currency, onlyAssigneeId: null, canViewFinances: true });
  assert.ok(home.needsYou.length >= 0 && home.handled.runs.length > 0 && home.money);
  const gated = await repository.getPortalHome(harbor!.id, { timezone: harbor!.timezone, currency: harbor!.currency, onlyAssigneeId: "nobody", canViewFinances: false });
  assert.equal(gated.money, null);
  const rows = await repository.getPortfolio(tenants);
  assert.equal(rows.length, tenants.length);
  assert.ok(rows.every((r) => r.health >= 0 && r.health <= 100));
});

await step("content: create assets and decide", async () => {
  const [asset] = await repository.createContentAssets(harbor!.id, [{ kind: "POST_COPY", title: `Parity ${stamp}`, body: "x", targetPlatform: "FACEBOOK", status: "IN_REVIEW", needsClientSignoff: false, tags: [], scheduledFor: null }]);
  const updated = await repository.updateContentAssetStatus(harbor!.id, asset.id, "APPROVED");
  assert.equal(updated?.status, "APPROVED");
  assert.equal(await repository.updateContentAssetStatus(summit!.id, asset.id, "REJECTED"), null, "other tenant cannot touch it");
});

await step("information requests, form sessions, consent, lapsed candidates", async () => {
  const lead = await repository.findLeadById(harbor!.id, greenLeadId);
  const req = await repository.createInformationRequest(harbor!.id, { contactId: lead!.contactId, leadId: lead!.id, kind: "document", description: "the signed agreement", dueAt: null });
  assert.equal((await repository.updateInformationRequest(harbor!.id, req.id, { status: "RECEIVED", receivedAt: new Date() }))?.status, "RECEIVED");
  await repository.upsertFormSession(harbor!.id, { sessionKey: `sess_${stamp}`, formName: "appraisal", pageUrl: null, partial: { email: `aband-${stamp}@example.com` } });
  const abandoned = await repository.listAbandonedFormSessions(harbor!.id, new Date(Date.now() + 60_000));
  assert.ok(abandoned.some((f) => f.sessionKey === `sess_${stamp}`));
  await repository.setContactConsent(harbor!.id, lead!.contactId!, "sms", true, "parity");
  assert.equal((await repository.findContactById(harbor!.id, lead!.contactId!))?.consent.sms?.granted, true);
  assert.ok(Array.isArray(await repository.listLapsedCandidates(harbor!.id, new Date())));
});

await step("content engine: material → drafts → approval → scheduled post → simulated publish", async () => {
  process.env.SOCIAL_MODE = "log";
  process.env.CONTENT_ENGINE = "stub";
  const channels = await repository.listChannels(harbor!.id, { activeOnly: true });
  assert.ok(channels.length >= 1, "seeded channels present");
  const source = await ingestSource(harbor!, { kind: "RAW_TEXT", title: `Parity material ${stamp}`, body: "Three owners switched to us this month because nobody called them back. We call back the same day and send a written update after every inspection.", origin: "operator" });
  const { drafts, skipped } = await generateFromSource(harbor!, source.id);
  assert.equal(skipped, null);
  assert.equal(drafts.length, new Set(channels.map((c) => c.platform)).size, "one draft per channel");
  const again = await generateFromSource(harbor!, source.id);
  assert.equal(again.drafts.length, 0, "idempotent per source");
  const draft = drafts.find((d) => d.targetPlatform === "FACEBOOK") ?? drafts[0];
  await repository.updateContentAssetStatus(harbor!.id, draft.id, "APPROVED");
  const { post } = await scheduleApproved(harbor!, { ...draft, status: "APPROVED" }, { at: new Date(Date.now() - 1000) });
  assert.ok(post && post.status === "SCHEDULED");
  assert.equal(await repository.claimSocialPost(post!.id, new Date(), 600_000), true);
  await repository.updateSocialPost(harbor!.id, post!.id, { status: "SCHEDULED" });
  const published = await publishDuePosts(new Date());
  assert.ok(published.simulated >= 1, "simulated publish");
  assert.equal((await repository.findSocialPostById(harbor!.id, post!.id))?.status, "PUBLISHED");
  assert.equal((await repository.findContentAssetById(harbor!.id, draft.id))?.status, "PUBLISHED");
  await repository.recordChannelMetrics(harbor!.id, { channelId: channels[0].id, platform: channels[0].platform, date: new Date(), followers: 10, reach: 5 });
  await repository.recordChannelMetrics(harbor!.id, { channelId: channels[0].id, platform: channels[0].platform, date: new Date(), followers: 11, reach: 6 });
  const today = new Date().toISOString().slice(0, 10);
  const todays = (await repository.listChannelMetrics(harbor!.id, { since: new Date(Date.now() - 86_400_000), channelId: channels[0].id })).filter((m) => m.date.toISOString().slice(0, 10) === today);
  assert.equal(todays.length, 1, "one snapshot per channel per day");
  assert.equal(todays[0].followers, 11, "the later record wins");
  const fresh = await ingestInboxItems(harbor!, channels[0], [{ externalId: `c_${stamp}`, threadId: `post_${stamp}`, kind: "COMMENT", authorName: "Parity Commenter", authorId: "u_parity", text: "Thanks so much, you were brilliant", receivedAt: new Date() }]);
  assert.equal(fresh, 1);
  assert.equal(await ingestInboxItems(harbor!, channels[0], [{ externalId: `c_${stamp}`, threadId: `post_${stamp}`, kind: "COMMENT", authorName: "Parity Commenter", authorId: "u_parity", text: "Thanks so much, you were brilliant", receivedAt: new Date() }]), 0, "deduped by provider id");
  const convo = (await repository.listInboxConversations(harbor!.id, { awaitingOnly: true })).find((c) => c.externalId === `post_${stamp}`);
  assert.ok(convo?.suggestedReply, "triage drafted a reply");
  const reply = await replyToConversation(harbor!, convo!.id, "Thank you!", "OPERATOR");
  assert.equal(reply.ok, true);
  assert.equal((await repository.findConversationById(harbor!.id, convo!.id))?.awaitingReply, false);
});

await step("money: ad spend, pacing, attribution, invoices, reminders, website roll-up", async () => {
  process.env.ADS_MODE = "log";
  process.env.FINANCE_MODE = "log";
  const account = await repository.upsertAdAccount(harbor!.id, { platform: "META", externalAccountId: `act_parity_${stamp}`, name: "Parity Meta", currency: "AUD", monthlyBudgetCents: 100_000 });
  const sync = await runAdsSync(harbor!);
  assert.ok(sync.rows > 0, "spend rows recorded through the log provider");
  assert.equal(await repository.recordAdSpend(harbor!.id, [{ adAccountId: account.id, platform: "META", date: new Date(), campaignId: "demo_campaign_1", campaignName: "Landlord leads", spendCents: 999 }]), 1, "same day+campaign upserts");
  const pacing = await pacingStatus(harbor!);
  assert.ok(pacing && pacing.budgetCents >= 100_000);
  const report = await buildAttributionReport(harbor!, new Date(Date.now() - 30 * 86_400_000));
  assert.ok(report.totals.spendCents > 0 && report.rows.some((r) => r.source === "facebook"));
  await repository.upsertInvoices(harbor!.id, [{ provider: "XERO", externalId: `parity_inv_${stamp}`, number: `P-${stamp}`, amountCents: 12_000, amountDueCents: 12_000, currency: "AUD", status: "SENT", dueAt: new Date(Date.now() - 86_400_000), customerName: "Parity Customer", customerEmail: `parity-inv-${stamp}@example.com` }]);
  assert.ok((await markOverdue(harbor!)) >= 1);
  const reminders = await runInvoiceReminders(harbor!);
  assert.ok(reminders.chased >= 1, "overdue invoice chased");
  const { paidNow } = await repository.upsertInvoices(harbor!.id, [{ provider: "XERO", externalId: `parity_inv_${stamp}`, amountCents: 12_000, amountDueCents: 0, currency: "AUD", status: "PAID", paidAt: new Date() }]);
  assert.equal(paidNow.length, 1, "PAID transition reported once");
  const link = await repository.createTrackedLink(harbor!.id, { code: `parity-${stamp}`, destination: "https://example.com/x", source: "signboard" });
  await repository.incrementTrackedLinkClicks(link.id);
  assert.equal((await repository.findTrackedLinkByCode(link.code))?.clicks, 1);
  await repository.recordWebEvents(harbor!.id, [{ kind: "PAGEVIEW", path: "/", sessionKey: `s_${stamp}` }, { kind: "FORM_START", path: "/", sessionKey: `s_${stamp}` }]);
  const rolled = await rollupSite(harbor!, new Date());
  assert.ok(rolled.pageviews >= 1);
  const home = await repository.getPortalHome(harbor!.id, { timezone: harbor!.timezone, currency: harbor!.currency, onlyAssigneeId: null, canViewFinances: true });
  assert.ok(home.money && home.money.adSpendMonthCents > 0 && typeof home.money.profitMonthCents === "number");
});

await step("launch: provision a workspace, invite, API key, inventory import, readiness", async () => {
  registerInventory();
  const fresh = await provisionTenant({ templateKey: "real_estate", name: `Parity Property ${stamp}`, slug: `parity-${stamp}`, region: "AU", timezone: "Australia/Adelaide", locale: "en-AU", currency: "AUD", replyTo: `parity-${stamp}@example.com`, requiredFooter: "Parity Property | RLA 000000" });
  const config = await repository.getTenantConfig(fresh.id);
  assert.ok(config.roles.length >= 3 && config.pipelines.length >= 1 && config.brand?.complianceBlock.requiredFooter === "Parity Property | RLA 000000", "template applied with footer");
  const role = config.roles.find((r) => r.permissions.includes("RECEIVE_LEAD_ALERTS"))!;
  const invite = await inviteMember(fresh.id, { email: `parity-owner-${stamp}@example.com`, name: "Parity Owner", roleId: role.id });
  assert.ok(invite.created && invite.temporaryPassword, "one-time password issued");
  const people = await repository.listTenantPeople(fresh.id);
  assert.ok(people.some((p) => p.via === "member" && p.permissions.includes("RECEIVE_LEAD_ALERTS")), "member listed with permissions");
  const operators = await repository.listOperators();
  if (operators[0]) await repository.assignOperator(fresh.id, operators[0].id);
  const issued = await issueApiKey(fresh.id, "Parity forms", ["intake"]);
  const resolved = await repository.findTenantByApiKeyHash(hashApiKey(issued.raw));
  assert.equal(resolved?.tenant.id, fresh.id, "issued key resolves");
  assert.deepEqual(resolved?.scopes, ["intake"]);
  const imported = await importInventory(fresh, csvToInventory(`address,suburb,status,rent,bedrooms,url\n"${stamp} Parity Street",Glenelg,available,620,2,https://example.com/${stamp}`).items);
  assert.equal(imported.created, 1);
  assert.equal(await importInventory(fresh, csvToInventory(`address,status\n"${stamp} Parity Street",leased`).items).then((r) => r.updated), 1, "same address updates");
  assert.equal(await findListingMentioned(fresh.id, `about ${stamp} parity street`), null, "leased listing not offered");
  const readiness = readinessSummary(await tenantReadiness(fresh));
  assert.ok(readiness.requiredTotal > 0 && readiness.requiredPassed > 0);
  await repository.revokeApiKey(fresh.id, issued.key.id);
  assert.equal(await repository.findTenantByApiKeyHash(hashApiKey(issued.raw)), null, "revoked key stops resolving");
  await repository.updateTenant(fresh.id, { isActive: false });
});

console.log(failures === 0 ? "\nAll parity steps passed." : `\n${failures} parity step(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
