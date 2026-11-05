import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { AUTONOMY_LEVELS, agentsMode, decideTool, effectiveAutonomy, type ToolRisk } from "@/lib/agents/policy";
import { AGENT_ROLES, ROLE_BY_KEY } from "@/lib/agents/roles";
import { claudeToolDefinition, runTool } from "@/lib/agents/tool";
import { AGENT_TOOLS, offeredTools, TOOL_BY_NAME } from "@/lib/agents/tools";
import { repository } from "@/lib/data";
import { demoExceptions, demoLeads, demoMissed, demoTenants } from "@/lib/data/fixtures";
import { sendMessage } from "@/lib/messaging";
import type { AgentToolOverride } from "@/lib/types";

const [harbor, summit] = demoTenants;
const RISKS: ToolRisk[] = ["read", "draft", "internal", "external", "financial"];
const OVERRIDES: (AgentToolOverride | undefined)[] = [undefined, "auto", "ask", "off"];

before(() => {
  process.env.MESSAGING_MODE = "log";
  process.env.DEFAULT_FROM_EMAIL = "hello@example.com";
  process.env.DEFAULT_FROM_NUMBER = "+15555550000";
});

describe("agent tool policy", () => {
  it("decides each risk at each autonomy as the plan sets out", () => {
    const table = Object.fromEntries(AUTONOMY_LEVELS.map((a) => [a, RISKS.map((risk) => decideTool({ risk, autonomy: a, moduleOn: true }).decision).join(" ")]));
    assert.deepEqual(table, {
      SHADOW: "run propose propose propose refuse",
      SUGGEST: "run run ask ask refuse",
      SUPERVISED: "run run run ask refuse",
      DELEGATED: "run run run ask refuse",
    });
  });

  it("holds its rules over every combination of risk, autonomy, override and module", () => {
    for (const autonomy of AUTONOMY_LEVELS)
      for (const risk of RISKS)
        for (const override of OVERRIDES)
          for (const moduleOn of [true, false]) {
            const { decision, reason } = decideTool({ risk, autonomy, override, moduleOn });
            const label = `${autonomy}/${risk}/${override ?? "-"}/${moduleOn}`;
            assert.ok(reason.length > 0, label);
            if (!moduleOn || override === "off" || risk === "financial") assert.equal(decision, "refuse", label);
            if (autonomy === "SHADOW") assert.notEqual(decision, "ask", `${label}: a shadow agent never asks anyone`);
            if (autonomy === "SHADOW" && decision === "run") assert.ok(risk === "read" && override !== "ask", label);
            if (override === "ask") assert.notEqual(decision, "run", label);
            if (risk === "external" && decision === "run") assert.ok(autonomy === "DELEGATED" && override === "auto", label);
            if (autonomy !== "SHADOW" && (risk === "read" || risk === "draft") && moduleOn && !override) assert.equal(decision, "run", label);
          }
  });

  it("caps a tenant's autonomy at the role's ceiling, and keeps every agent in shadow unless the deployment is live", () => {
    assert.equal(effectiveAutonomy("DELEGATED", "SUPERVISED", "live"), "SUPERVISED");
    assert.equal(effectiveAutonomy("SUGGEST", "DELEGATED", "live"), "SUGGEST");
    assert.equal(effectiveAutonomy("DELEGATED", "DELEGATED", "shadow"), "SHADOW");
    assert.equal(effectiveAutonomy("DELEGATED", "DELEGATED", "off"), "SHADOW");
    assert.equal(agentsMode({}), "off");
    assert.equal(agentsMode({ AGENTS_MODE: "live" }), "live");
    assert.equal(agentsMode({ AGENTS_MODE: "on" }), "off", "anything unrecognised is off");
  });
});

describe("agent roles and tools", () => {
  it("only lists tools that exist, and only the Director hands work on", () => {
    for (const role of AGENT_ROLES) {
      for (const name of role.tools) assert.ok(TOOL_BY_NAME[name], `${role.key} lists ${name}`);
      for (const key of role.canDelegateTo) assert.ok(ROLE_BY_KEY[key] && ROLE_BY_KEY[key].canDelegateTo.length === 0, `${role.key} delegates to ${key}, a specialist`);
    }
    assert.deepEqual(
      AGENT_ROLES.filter((r) => r.canDelegateTo.length > 0).map((r) => r.key),
      ["ops_director"],
    );
  });

  it("gives Claude a strict schema per tool, with limits left to the tool's own validation", () => {
    for (const tool of AGENT_TOOLS) {
      const def = claudeToolDefinition(tool);
      assert.match(def.name, /^[a-z_]+$/);
      assert.equal(def.strict, true);
      assert.equal(def.input_schema.type, "object");
      assert.equal(def.input_schema.additionalProperties, false);
      const text = JSON.stringify(def.input_schema);
      for (const keyword of ["$schema", "minimum", "maximum", "minLength", "maxLength"]) assert.ok(!text.includes(`"${keyword}"`), `${tool.name} drops ${keyword}`);
    }
  });

  it("leaves out tools whose module is off or that the tenant switched off", () => {
    const role = ROLE_BY_KEY.ops_director;
    const on = [{ moduleKey: "opportunities", enabled: true }];
    assert.deepEqual(offeredTools(role, on, {}).map((t) => t.name), ["list_missed_opportunities", "list_open_exceptions", "get_lead"]);
    assert.deepEqual(offeredTools(role, [{ moduleKey: "opportunities", enabled: false }], {}).map((t) => t.name), ["list_open_exceptions", "get_lead"]);
    assert.deepEqual(offeredTools(role, on, { get_lead: "off" }).map((t) => t.name), ["list_missed_opportunities", "list_open_exceptions"]);
  });

  it("hands invalid input back to the agent as an error instead of running", async () => {
    const out = await runTool(TOOL_BY_NAME.list_missed_opportunities, { tenant: harbor, callKey: "run_1:tu_1" }, { limit: 500 });
    assert.equal(out.ok, false);
    assert.match(out.ok ? "" : out.error, /limit/);
  });
});

describe("tools stay inside the run's workspace", () => {
  const ctx = { tenant: harbor, callKey: "run_1:tu_2" };

  it("cannot read another workspace's lead, even with its id", async () => {
    const theirs = demoLeads.find((l) => l.tenantId === summit.id);
    const ours = demoLeads.find((l) => l.tenantId === harbor.id);
    assert.ok(theirs && ours);
    const denied = await runTool(TOOL_BY_NAME.get_lead, ctx, { leadId: theirs.id });
    assert.deepEqual(denied, { ok: false, error: "There is no lead with that id in this workspace." });
    const allowed = await runTool(TOOL_BY_NAME.get_lead, ctx, { leadId: ours.id });
    assert.ok(allowed.ok);
    const lead = allowed.result as Record<string, unknown>;
    assert.equal(lead.id, ours.id);
    const shown = JSON.stringify(lead);
    if (ours.phone) assert.ok(!shown.includes(ours.phone), "no phone number in a tool result");
    if (ours.email) assert.ok(!shown.includes(ours.email), "no email address in a tool result");
  });

  it("lists only this workspace's missed opportunities and exceptions", async () => {
    const theirs = new Set([...demoMissed, ...demoExceptions].filter((x) => x.tenantId === summit.id).map((x) => x.id));
    for (const name of ["list_missed_opportunities", "list_open_exceptions"]) {
      const out = await runTool(TOOL_BY_NAME[name], ctx, { limit: 25 });
      assert.ok(out.ok, name);
      const items = (out.result as { items: { id: string }[] }).items;
      assert.ok(items.every((i) => !theirs.has(i.id)), `${name} returned another workspace's row`);
    }
  });
});

describe("a send an agent may retry", () => {
  it("goes out once per idempotency key, and the second call says so", async () => {
    const contact = await repository.upsertContact(harbor.id, { firstName: "Robin", lastName: null, email: "robin@example.com", phone: null, company: null });
    const send = () => sendMessage({ tenant: harbor, contactId: contact.id, channel: "EMAIL", to: contact.email!, body: "Following up on your enquiry.", transactional: true, sender: "AGENT", idempotencyKey: "run_9:toolu_1" });
    const first = await send();
    const second = await send();
    assert.equal(first.ok, true);
    assert.equal(first.duplicate, undefined);
    assert.equal(second.ok, true);
    assert.equal(second.duplicate, true);
    assert.equal(second.messageId, first.messageId, "the second call returns the first message");
    assert.equal((await repository.findMessageByIdempotencyKey(harbor.id, "run_9:toolu_1"))?.id, first.messageId);
    assert.equal(await repository.findMessageByIdempotencyKey(summit.id, "run_9:toolu_1"), null, "keys are per workspace");
  });

  it("does not retry a refused send under the same key", async () => {
    const contact = await repository.upsertContact(harbor.id, { firstName: "Far", lastName: null, email: null, phone: "+8801700000002", company: null });
    const send = () => sendMessage({ tenant: harbor, contactId: contact.id, channel: "SMS", to: contact.phone!, body: "hi", transactional: true, sender: "AGENT", idempotencyKey: "run_9:toolu_2" });
    const first = await send();
    const second = await send();
    assert.equal(first.ok, false);
    assert.equal(second.ok, false);
    assert.equal(second.duplicate, true);
  });
});

describe("a tenant's agents", () => {
  it("starts switched off in shadow, changes only what is patched, and stays in its workspace", async () => {
    const created = await repository.upsertTenantAgent(harbor.id, "customer_relations", { instructions: "Never offer appraisal times on Sundays." }, null);
    assert.equal(created.enabled, false);
    assert.equal(created.autonomy, "SHADOW");
    const updated = await repository.upsertTenantAgent(harbor.id, "customer_relations", { enabled: true, autonomy: "SUPERVISED", toolPolicy: { get_lead: "ask" } }, "user_op");
    assert.equal(updated.instructions, "Never offer appraisal times on Sundays.");
    assert.equal(updated.autonomy, "SUPERVISED");
    assert.deepEqual(updated.toolPolicy, { get_lead: "ask" });
    assert.equal(updated.updatedById, "user_op");
    assert.deepEqual((await repository.listTenantAgents(harbor.id)).map((a) => a.roleKey), ["customer_relations"]);
    assert.deepEqual(await repository.listTenantAgents(summit.id), []);
  });
});
