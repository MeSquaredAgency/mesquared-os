import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasPermission, ROLE_TEMPLATES } from "@/lib/auth/permissions";
import { repository } from "@/lib/data";
import { demoTenants } from "@/lib/data/fixtures";
import { healthScore } from "@/lib/health";
import { detectForTenant } from "@/lib/opportunities/detect";
import { materializeTemplate } from "@/lib/templates/apply";
import { getTemplate, TEMPLATES } from "@/lib/templates";
import { MODULES } from "@/lib/modules/registry";
import { AUTOMATIONS } from "@/lib/automations/registry";
import { COPY } from "@/lib/copy";

describe("industry templates", () => {
  it("materialise into roles, pipelines, modules, automations and a brand for any tenant", () => {
    let n = 0;
    for (const template of TEMPLATES) {
      const m = materializeTemplate(template, "t_x", (p) => `${p}_${++n}`);
      assert.ok(m.roles.length >= 4);
      assert.ok(m.pipelines.some((p) => p.isDefault), `${template.key} has a default pipeline`);
      assert.equal(m.modules.length, MODULES.length);
      assert.equal(m.automations.length, AUTOMATIONS.length);
      assert.ok(m.automations.find((a) => a.typeKey === "sla_watch")?.enabled, `${template.key} watches SLAs`);
      assert.ok(m.brand.complianceBlock.mustNot?.length);
      for (const p of m.pipelines) assert.deepEqual(p.stages.map((s) => s.order), p.stages.map((_, i) => i));
    }
    assert.equal(getTemplate("nope").key, "generic");
  });

  it("real estate template names roles the way the brief describes and keeps management as default", () => {
    const t = getTemplate("real_estate");
    assert.deepEqual(t.roles.map((r) => r.name), ["Director", "Region Manager", "Property Manager", "Team member", "External accountant"]);
    assert.equal(t.pipelines.find((p) => p.isDefault)?.key, "management");
    assert.equal(t.qualificationRules.requirePhone, true);
  });
});

describe("permissions", () => {
  it("members get exactly their role's permissions; operators and admins get everything", () => {
    const staff = ROLE_TEMPLATES.find((r) => r.key === "staff")!;
    assert.equal(hasPermission({ via: "member", permissions: staff.permissions }, "VIEW_FINANCES"), false);
    assert.equal(hasPermission({ via: "member", permissions: staff.permissions }, "RECEIVE_LEAD_ALERTS"), true);
    assert.equal(hasPermission({ via: "operator", permissions: [] }, "VIEW_FINANCES"), true);
    assert.equal(hasPermission({ via: "admin", permissions: [] }, "MANAGE_USERS"), true);
    const accountant = ROLE_TEMPLATES.find((r) => r.key === "accountant")!;
    assert.deepEqual(accountant.permissions, ["VIEW_FINANCES"]);
  });

  it("access listing follows memberships and operator assignments", async () => {
    const admin = await repository.listTenantAccess("user_admin");
    assert.equal(admin.length, 2);
    assert.ok(admin.every((a) => a.via === "admin"));
    const ops = await repository.listTenantAccess("user_ops");
    assert.equal(ops.length, 2);
    assert.ok(ops.every((a) => a.via === "operator"));
    const pm = await repository.listTenantAccess("user_pm");
    assert.equal(pm.length, 1);
    assert.equal(pm[0].via, "member");
    assert.equal(pm[0].roleName, "Property Manager");
    assert.equal(hasPermission(pm[0], "VIEW_ALL_RECORDS"), false);
    assert.equal((await repository.listTenantAccess("nobody")).length, 0);
  });
});

describe("portal home and portfolio", () => {
  it("hides money without VIEW_FINANCES and scopes Needs you to own or unassigned leads", async () => {
    const tenant = demoTenants[0];
    const pmHome = await repository.getPortalHome(tenant.id, { timezone: tenant.timezone, currency: tenant.currency, onlyAssigneeId: "user_pm", canViewFinances: false });
    assert.equal(pmHome.money, null);
    assert.ok(pmHome.needsYou.every((l) => l.assigneeId === "user_pm" || l.assigneeId === null));
    const dirHome = await repository.getPortalHome(tenant.id, { timezone: tenant.timezone, currency: tenant.currency, onlyAssigneeId: null, canViewFinances: true });
    assert.ok(dirHome.money && dirHome.money.revenueMonthCents > 0);
    assert.ok(dirHome.missed.atRiskCents > 0);
    assert.ok(dirHome.handled.runs.length > 0);
  });

  it("portfolio rows carry breaches, exceptions and integration health, worst first", async () => {
    const rows = await repository.getPortfolio(demoTenants);
    assert.equal(rows.length, 2);
    assert.ok(rows[0].health <= rows[1].health);
    const harbor = rows.find((r) => r.tenant.id === "tenant_harbor")!;
    assert.ok(harbor.integrations.some((i) => i.status === "NEEDS_ATTENTION"));
    assert.ok(harbor.exceptionsOpen >= 1);
    assert.ok(harbor.slaBreaches >= 1, "fixture lead_4 is past its booking window");
  });

  it("health score deducts for each dimension and clamps", () => {
    const clean = healthScore({ tenant: demoTenants[0], slaBreaches: 0, missedOpen: 0, missedAtRiskCents: 0, exceptionsOpen: 0, contentDue: 0, adPacing: null, integrations: [], leadsToday: 0 });
    assert.equal(clean, 100);
    const bad = healthScore({ tenant: demoTenants[0], slaBreaches: 9, missedOpen: 9, missedAtRiskCents: 1, exceptionsOpen: 9, contentDue: 0, adPacing: null, integrations: [{ provider: "META", status: "DISCONNECTED", lastError: null }, { provider: "CALCOM", status: "DISCONNECTED", lastError: null }], leadsToday: 0 });
    assert.equal(bad, 10);
  });
});

describe("SLA detector", () => {
  it("raises one missed opportunity, exception and run per lead past its window, and is idempotent", async () => {
    const tenant = demoTenants[0];
    await detectForTenant(tenant);
    // Fixture lead_4 already has an open NOT_BOOKED item; the detector must not add a second one.
    const notBooked = (await repository.listMissedOpportunities(tenant.id, { status: ["ESCALATED", "DETECTED", "RECOVERING"], limit: 500 })).filter((m) => m.type === "NOT_BOOKED" && m.leadId === "lead_4");
    assert.equal(notBooked.length, 1);
    const openBefore = (await repository.listMissedOpportunities(tenant.id, { status: ["ESCALATED", "DETECTED", "RECOVERING"] })).length;
    const second = await detectForTenant(tenant);
    assert.equal(second.detected.length, 0, "second pass finds nothing new");
    const openAfter = (await repository.listMissedOpportunities(tenant.id, { status: ["ESCALATED", "DETECTED", "RECOVERING"] })).length;
    assert.equal(openAfter, openBefore);
  });
});

describe("client-facing copy", () => {
  it("never says green or red", () => {
    for (const value of Object.values(COPY)) assert.doesNotMatch(value.toLowerCase(), /\b(green|red)\b/);
  });
});
