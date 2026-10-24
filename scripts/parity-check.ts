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

console.log(failures === 0 ? "\nAll parity steps passed." : `\n${failures} parity step(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
