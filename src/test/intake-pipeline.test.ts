import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { repository } from "@/lib/data";
import { demoTenants } from "@/lib/data/fixtures";
import { processIntake } from "@/lib/intake/process";
import { intakeSchema } from "@/lib/intake/schema";

// These run against the in-memory repository (DATABASE_URL is unset in tests).
const tenant = demoTenants[0]; // real estate template
const other = demoTenants[1]; // health & fitness template

describe("intake pipeline (demo repository)", () => {
  it("creates a contact and a green lead on the default pipeline with SLA deadlines and a booking link", async () => {
    const body = intakeSchema.parse({
      source: "META_LEAD_FORM",
      externalId: "test_green_1",
      name: "Test Owner",
      email: "green-pipeline@example.com",
      phone: "+61 400 111 000",
      message: "I own a unit in Adelaide and want an appraisal and someone to manage it.",
      fields: { utm_source: "facebook", utm_campaign: "landlord-oct" },
    });
    const before = Date.now();
    const result = await processIntake(tenant, body, { any: "payload" });
    assert.equal(result.outcome, "created");
    if (result.outcome !== "created") return;
    assert.equal(result.qualification.ticketType, "GREEN");
    // Harbor has Cal.com connected, so the link is a prefilled Cal.com event with the lead id in metadata.
    assert.ok(result.bookingUrl && (result.bookingUrl.includes(`metadata%5BleadId%5D=${result.lead.id}`) || result.bookingUrl.includes(`/book/${tenant.slug}?lead=${result.lead.id}`)));
    assert.ok(result.lead.contactId, "contact linked");
    const config = await repository.getTenantConfig(tenant.id);
    const pipeline = config.pipelines.find((p) => p.isDefault)!;
    assert.equal(result.lead.pipelineId, pipeline.id);
    assert.equal(result.lead.stageId, pipeline.stages[0].id);
    assert.ok(result.lead.respondBy && result.lead.respondBy.getTime() >= before + tenant.sla.firstResponseMinutes * 60_000 - 1000);
    assert.ok(result.lead.bookBy && result.lead.bookBy.getTime() > before + 60 * 60_000);
    assert.equal(result.lead.valueCents, tenant.opportunityValues.NOT_BOOKED);
    assert.equal(result.lead.status, "QUALIFIED");
    assert.deepEqual(result.lead.attribution, { source: "facebook", campaign: "landlord-oct" });
    const needs = await repository.listNeedsYou(tenant.id, { onlyAssigneeId: null, limit: 20 });
    assert.ok(needs.some((l) => l.id === result.lead.id), "appears in Needs you");
    const runs = await repository.listAutomationRuns(tenant.id, 5);
    assert.ok(runs.some((r) => r.leadId === result.lead.id && r.typeKey === "enquiry_auto_reply"));
    const events = await repository.listEvents(tenant.id, 10);
    assert.ok(events.some((e) => e.type === "lead.qualified" && e.payload.leadId === result.lead.id));
  });

  it("routes a red item as handled, with no pipeline or deadlines", async () => {
    const body = intakeSchema.parse({
      source: "PORTAL_EMAIL",
      externalId: "test_red_1",
      email: "renter-pipeline@example.com",
      message: "Is the unit on Marine Parade still available? When is the next inspection time?",
    });
    const result = await processIntake(tenant, body, {});
    assert.equal(result.outcome, "created");
    if (result.outcome !== "created") return;
    assert.equal(result.qualification.ticketType, "RED");
    assert.equal(result.bookingUrl, null);
    assert.equal(result.lead.pipelineId, null);
    assert.equal(result.lead.respondBy, null);
    const runs = await repository.listAutomationRuns(tenant.id, 5);
    assert.ok(runs.some((r) => r.leadId === result.lead.id && r.outcome === "COMPLETED"));
  });

  it("dedupes on externalId and on recent contact details", async () => {
    const first = intakeSchema.parse({ externalId: "dup_1", email: "dup@example.com", message: "appraisal please" });
    const created = await processIntake(tenant, first, {});
    assert.equal(created.outcome, "created");
    const byExternal = await processIntake(tenant, intakeSchema.parse({ externalId: "dup_1", email: "someone-else@example.com" }), {});
    assert.equal(byExternal.outcome, "duplicate");
    const byEmail = await processIntake(tenant, intakeSchema.parse({ email: "DUP@example.com", message: "again" }), {});
    assert.equal(byEmail.outcome, "duplicate");
  });

  it("never dedupes or links contacts across tenants", async () => {
    const body = intakeSchema.parse({ externalId: "shared_ext", email: "cross@example.com", message: "join" });
    const a = await processIntake(tenant, body, {});
    const b = await processIntake(other, body, {});
    assert.equal(a.outcome, "created");
    assert.equal(b.outcome, "created");
    if (a.outcome !== "created" || b.outcome !== "created") return;
    assert.notEqual(a.lead.id, b.lead.id);
    assert.notEqual(a.lead.contactId, b.lead.contactId);
    const otherLeads = await repository.listRecentLeads(other.id, 50);
    assert.ok(otherLeads.every((l) => l.tenantId === other.id));
  });

  it("dry run classifies without storing", async () => {
    const before = (await repository.listRecentLeads(tenant.id, 500)).length;
    const result = await processIntake(tenant, intakeSchema.parse({ email: "dry@example.com", message: "sell my house", dryRun: true }), {});
    assert.equal(result.outcome, "dry_run");
    const after = (await repository.listRecentLeads(tenant.id, 500)).length;
    assert.equal(after, before);
  });
});
