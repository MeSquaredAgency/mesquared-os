import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { repository } from "@/lib/data";
import { demoTenants } from "@/lib/data/fixtures";
import { processIntake } from "@/lib/intake/process";
import { intakeSchema } from "@/lib/intake/schema";

// These run against the in-memory repository (DATABASE_URL is unset in tests).
const tenant = demoTenants[0];
const other = demoTenants[1];

describe("intake pipeline (demo repository)", () => {
  it("routes a green lead: booking link ready, urgent task, lead stays QUALIFIED until the link is sent", async () => {
    const body = intakeSchema.parse({
      source: "META_LEAD_FORM",
      externalId: "test_green_1",
      name: "Test Green",
      email: "green-pipeline@example.com",
      phone: "+61 400 111 000",
      message: "Interested in dental implants, can I book a consult this week?",
      fields: { budget: "$4,000", timeline: "this week" },
    });
    const result = await processIntake(tenant, body, { any: "payload" });
    assert.equal(result.outcome, "created");
    if (result.outcome !== "created") return;
    assert.equal(result.qualification.ticketType, "GREEN");
    assert.ok(result.bookingUrl?.includes(`/book/${tenant.slug}?lead=${result.lead.id}`));
    const board = await repository.getTicketBoard(tenant.id, { timezone: tenant.timezone, currency: tenant.currency });
    const task = board.greenTasks.find((t) => t.id === result.taskId);
    assert.ok(task, "green task created");
    assert.equal(task.priority, "URGENT");
    const lead = (await repository.listRecentLeads(tenant.id, 5)).find((l) => l.id === result.lead.id);
    assert.equal(lead?.status, "QUALIFIED");
  });

  it("routes a red lead to a nurture task without a booking", async () => {
    const body = intakeSchema.parse({
      source: "EMAIL",
      externalId: "test_red_1",
      email: "vendor-pipeline@example.com",
      message: "We offer SEO services and backlink packages. Partnership?",
    });
    const result = await processIntake(tenant, body, {});
    assert.equal(result.outcome, "created");
    if (result.outcome !== "created") return;
    assert.equal(result.qualification.ticketType, "RED");
    assert.equal(result.bookingUrl, null);
    const board = await repository.getTicketBoard(tenant.id, { timezone: tenant.timezone, currency: tenant.currency });
    assert.ok(board.redTasks.some((t) => t.id === result.taskId));
  });

  it("dedupes on externalId and on recent contact details", async () => {
    const first = intakeSchema.parse({ externalId: "dup_1", email: "dup@example.com", message: "quote please" });
    const created = await processIntake(tenant, first, {});
    assert.equal(created.outcome, "created");

    const byExternal = await processIntake(tenant, intakeSchema.parse({ externalId: "dup_1", email: "someone-else@example.com" }), {});
    assert.equal(byExternal.outcome, "duplicate");

    const byEmail = await processIntake(tenant, intakeSchema.parse({ email: "DUP@example.com", message: "again" }), {});
    assert.equal(byEmail.outcome, "duplicate");
  });

  it("never dedupes across tenants", async () => {
    const body = intakeSchema.parse({ externalId: "shared_ext", email: "cross@example.com" });
    const a = await processIntake(tenant, body, {});
    const b = await processIntake(other, body, {});
    assert.equal(a.outcome, "created");
    assert.equal(b.outcome, "created");
    if (a.outcome !== "created" || b.outcome !== "created") return;
    assert.notEqual(a.lead.id, b.lead.id);
    const otherLeads = await repository.listRecentLeads(other.id, 50);
    assert.ok(otherLeads.every((l) => l.tenantId === other.id));
  });

  it("dry run classifies without storing", async () => {
    const before = (await repository.listRecentLeads(tenant.id, 500)).length;
    const result = await processIntake(tenant, intakeSchema.parse({ email: "dry@example.com", message: "book now", dryRun: true }), {});
    assert.equal(result.outcome, "dry_run");
    const after = (await repository.listRecentLeads(tenant.id, 500)).length;
    assert.equal(after, before);
  });
});
