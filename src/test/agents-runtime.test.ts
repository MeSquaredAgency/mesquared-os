import assert from "node:assert/strict";
import { after, afterEach, before, describe, it, mock } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { _setClaudeClientForTests } from "@/lib/ai/claude";
import { AGENT_LEASE_MS, APPROVAL_TTL_MS, MAX_AGENT_STEPS, decideAgentAction, driveAgentRun, runAgentWork, startAgentRun } from "@/lib/agents/runtime";
import { ROLE_BY_KEY } from "@/lib/agents/roles";
import { defineTool, type AgentTool } from "@/lib/agents/tool";
import { TOOL_BY_NAME } from "@/lib/agents/tools";
import { repository } from "@/lib/data";
import { demoLeads, demoTenants } from "@/lib/data/fixtures";
import type { AgentRunRecord } from "@/lib/types";

const [harbor, summit] = demoTenants;
const ROLE = "test_runtime";
const ours = demoLeads.find((l) => l.tenantId === harbor.id)!;
const theirs = demoLeads.find((l) => l.tenantId === summit.id)!;

// --- test tools: one of each risk the runtime treats differently --------------------

const sent: { callKey: string; tenantId: string; to: string; body: string }[] = [];
let reads = 0;
let flakyFailures = 0;
const testTools: AgentTool[] = [
  defineTool({
    name: "test_read",
    description: "Counts.",
    input: z.object({ note: z.string() }),
    risk: "read",
    module: null,
    async run(ctx) {
      reads++;
      return { n: reads, tenant: ctx.tenant.id };
    },
  }),
  defineTool({
    name: "test_send",
    description: "Sends a message to a customer.",
    input: z.object({ to: z.string(), body: z.string() }),
    risk: "external",
    module: null,
    preview: (input) => ({ title: `text ${input.to}`, body: input.body }),
    async run(ctx, input) {
      sent.push({ callKey: ctx.callKey, tenantId: ctx.tenant.id, ...input });
      return { sent: true };
    },
  }),
  defineTool({ name: "test_pay", description: "Pays someone.", input: z.object({ cents: z.number() }), risk: "financial", module: null, run: async () => ({ paid: true }) }),
  defineTool({
    name: "test_flaky",
    description: "Updates a record; the provider is sometimes down.",
    input: z.object({}),
    risk: "internal",
    module: null,
    async run() {
      if (flakyFailures > 0) {
        flakyFailures--;
        throw new Error("provider down");
      }
      return { updated: true };
    },
  }),
] as AgentTool[];

// --- a scripted Claude ---------------------------------------------------------------

let n = 0;
const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null };
const reply = (content: Record<string, unknown>[], stop_reason = "end_turn", over: Record<string, unknown> = {}) => ({ id: `msg_${++n}`, type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason, stop_sequence: null, stop_details: null, usage, _request_id: `req_${n}`, ...over });
const thinking = (text: string) => ({ type: "thinking", thinking: text, signature: `sig_${n}_${text.length}` });
const text = (t: string) => ({ type: "text", text: t, citations: null });
const use = (id: string, name: string, input: Record<string, unknown>) => ({ type: "tool_use", id, name, input });

type Req = { model: string; max_tokens: number; system: { text: string; cache_control?: unknown }[]; tools?: { name: string; strict?: boolean }[]; messages: { role: string; content: Record<string, unknown>[] }[] } & Record<string, unknown>;

function script(...answers: unknown[]): Req[] {
  const requests: Req[] = [];
  _setClaudeClientForTests({
    messages: {
      async create(params: Req) {
        requests.push(structuredClone(params));
        const next = answers.shift();
        if (!next) throw new Error("no scripted answer left");
        if (next instanceof Error) throw next;
        return next;
      },
    },
  });
  return requests;
}

async function start(task = "Look into this.", over: Partial<Parameters<typeof startAgentRun>[0]> = {}): Promise<AgentRunRecord> {
  const out = await startAgentRun({ tenant: harbor, roleKey: ROLE, trigger: "test", task, ...over });
  assert.ok(out.ok, out.ok ? "" : out.reason);
  return out.run;
}

/** Claims the run as a worker would and steps it. */
async function drive(run: AgentRunRecord, now = new Date()) {
  assert.ok(await repository.claimAgentRun(run.id, now, AGENT_LEASE_MS), "the run is due and free");
  return driveAgentRun(run.id, run.tenantId, Date.now() + 10_000);
}

const fresh = async (run: AgentRunRecord) => (await repository.findAgentRun(run.tenantId, run.id))!;
const calls = (run: AgentRunRecord) => repository.listAgentToolCalls(run.tenantId, run.id);
const allExceptions = () => repository.listExceptions([harbor.id, summit.id], { status: ["OPEN", "IN_PROGRESS", "RESOLVED"], limit: 500 });
const setAgent = (patch: Parameters<typeof repository.upsertTenantAgent>[2]) => repository.upsertTenantAgent(harbor.id, ROLE, patch, null);
const lastToolResults = (req: Req) => req.messages.at(-1)!.content.map((b) => ({ id: b.tool_use_id, error: Boolean(b.is_error), content: String(b.content) }));

before(async () => {
  process.env.AGENTS_MODE = "live";
  process.env.MESSAGING_MODE = "log";
  for (const t of testTools) TOOL_BY_NAME[t.name] = t;
  ROLE_BY_KEY[ROLE] = { key: ROLE, name: "Test Agent", responsibilities: "Tests the runtime.", tools: ["get_lead", "test_read", "test_send", "test_pay", "test_flaky"], maxAutonomy: "DELEGATED", canDelegateTo: [] };
  await setAgent({ enabled: true, autonomy: "SUPERVISED", instructions: "Be brief." });
});

after(() => {
  for (const t of testTools) delete TOOL_BY_NAME[t.name];
  delete ROLE_BY_KEY[ROLE];
  _setClaudeClientForTests(null);
});

afterEach(async () => {
  mock.timers.reset();
  process.env.AGENTS_MODE = "live";
  await setAgent({ enabled: true, autonomy: "SUPERVISED", toolPolicy: {}, runTokenCap: null, monthlyBudgetMicros: null });
});

describe("the job", () => {
  it("does nothing while agents are off, and steps every due run when they are on", async () => {
    process.env.AGENTS_MODE = "off";
    assert.deepEqual(await runAgentWork(), { mode: "off", due: 0, outcomes: {} });
    const refused = await startAgentRun({ tenant: harbor, roleKey: ROLE, trigger: "test", task: "x" });
    assert.equal(refused.ok, false);

    process.env.AGENTS_MODE = "live";
    const run = await start();
    script(reply([text("Nothing to do.")]));
    const out = await runAgentWork({ budgetMs: 10_000 });
    assert.equal(out.outcomes.done, 1);
    assert.equal((await fresh(run)).status, "DONE");
  });
});

describe("a run", () => {
  it("calls a tool, sends the result back with the thinking untouched, and ends with a summary", async () => {
    const run = await start(`Brief the team on lead ${ours.id}.`, { leadId: ours.id });
    const turn1 = [thinking("Look the lead up first."), use("toolu_1", "get_lead", { leadId: ours.id })];
    const requests = script(reply(turn1, "tool_use"), reply([text("They want an appraisal. Call them today.")]));
    assert.equal(await drive(run), "done");

    const done = await fresh(run);
    assert.equal(done.status, "DONE");
    assert.equal(done.summary, "They want an appraisal. Call them today.");
    assert.equal(done.steps, 2);
    assert.equal(done.tokens, 2400);
    assert.ok(done.costMicros > 0);
    assert.ok(done.finishedAt);

    const [first, second] = requests;
    assert.equal(first.model, "claude-opus-5-5");
    assert.deepEqual(first.output_config, { effort: "medium" });
    assert.deepEqual(first.thinking, { type: "adaptive", display: "summarized" });
    assert.deepEqual(first.cache_control, { type: "ephemeral" }, "the automatic breakpoint follows the conversation");
    assert.deepEqual(first.system[0].cache_control, { type: "ephemeral" }, "and one sits on the system prompt");
    for (const key of ["temperature", "top_p", "top_k", "tool_choice"]) assert.ok(!(key in first), `no ${key}`);
    assert.ok(first.tools!.every((t) => t.strict === true));
    assert.deepEqual(first.tools!.map((t) => t.name), ["get_lead", "test_read", "test_send", "test_pay", "test_flaky"]);
    assert.match(first.system[0].text, /<untrusted>/);
    assert.match(first.system[0].text, /<operator_instructions>\nBe brief\.\n<\/operator_instructions>/);
    assert.doesNotMatch(first.system[0].text, /20\d\d/, "no date in the system prompt; it would break the cache");
    assert.match(String(first.messages[0].content[0].text), new RegExp(`Brief the team on lead ${ours.id}`));

    assert.equal(second.system[0].text, first.system[0].text, "the cached prefix is byte-for-byte the same");
    assert.deepEqual(second.tools, first.tools);
    assert.deepEqual(second.messages.slice(0, 1), first.messages, "earlier turns are never edited");
    assert.deepEqual(second.messages[1], { role: "assistant", content: turn1 }, "the thinking block and its signature go back as they came");
    const [result] = lastToolResults(second);
    assert.equal(result.id, "toolu_1");
    assert.equal(result.error, false);
    assert.match(result.content, new RegExp(ours.id));

    const since = new Date(Date.now() - 3_600_000);
    assert.equal((await repository.sumAiUsage(harbor.id, since, { featurePrefix: `agent:${ROLE}` })).calls >= 2, true, "each call is in the ledger under the role");
  });

  it("returns every result of a turn in one message, in order, with failures marked", async () => {
    const run = await start();
    const requests = script(
      reply([use("t1", "get_lead", { leadId: ours.id }), use("t2", "get_lead", { leadId: theirs.id }), use("t3", "get_lead", { lead: "x" }), use("t4", "delete_everything", {})], "tool_use"),
      reply([text("Done.")]),
    );
    assert.equal(await drive(run), "done");
    const results = lastToolResults(requests[1]);
    assert.deepEqual(results.map((r) => [r.id, r.error]), [["t1", false], ["t2", true], ["t3", true], ["t4", true]]);
    assert.match(results[1].content, /no lead with that id in this workspace/, "another workspace's lead stays invisible");
    assert.match(results[2].content, /Invalid input/);
    assert.match(results[3].content, /isn't available to this agent/);
  });

  it("is started once per trigger", async () => {
    const a = await startAgentRun({ tenant: harbor, roleKey: ROLE, trigger: "test", dedupeKey: "mo:abc", task: "x" });
    const b = await startAgentRun({ tenant: harbor, roleKey: ROLE, trigger: "test", dedupeKey: "mo:abc", task: "x" });
    assert.ok(a.ok && b.ok);
    assert.equal(b.run.id, a.run.id);
    assert.equal(b.created, false);
    script(reply([text("ok")]));
    await drive(a.run);
  });

  it("is held by one worker at a time, and taken over when its worker dies", async () => {
    const run = await start();
    const now = new Date();
    assert.equal(await repository.claimAgentRun(run.id, now, AGENT_LEASE_MS), true);
    assert.equal(await repository.claimAgentRun(run.id, now, AGENT_LEASE_MS), false);
    const later = new Date(now.getTime() + AGENT_LEASE_MS + 1000);
    assert.ok((await repository.listDueAgentRuns(later, AGENT_LEASE_MS)).some((r) => r.id === run.id), "a lapsed lease makes the run due again");
    assert.equal(await repository.claimAgentRun(run.id, later, AGENT_LEASE_MS), true);
    script(reply([text("ok")]));
    assert.equal(await driveAgentRun(run.id, run.tenantId, Date.now() + 10_000), "done");
  });
});

describe("what a person decides", () => {
  it("parks an action a customer would see until a person approves it, then runs it once", async () => {
    const run = await start("Follow up with Robin.");
    const requests = script(reply([use("s1", "test_send", { to: "Robin", body: "Hi Robin, following up." })], "tool_use"), reply([text("Sent the follow-up.")]));
    assert.equal(await drive(run), "waiting");
    assert.equal((await fresh(run)).status, "WAITING");
    assert.equal(sent.length, 0, "nothing went out");
    assert.equal(requests.length, 1);

    const [call] = await calls(run);
    assert.equal(call.status, "AWAITING_APPROVAL");
    const card = (await allExceptions()).find((e) => e.agentToolCallId === call.id);
    assert.ok(card, "the approval is in the operator queue");
    assert.equal(card.status, "OPEN");
    assert.equal(card.agentRunId, run.id);
    assert.match(card.reason, /Test Agent wants to text Robin/);
    assert.equal(card.suggestedAction, "Hi Robin, following up.", "the person sees exactly what would be sent");
    assert.equal(await repository.claimAgentRun(run.id, new Date(), AGENT_LEASE_MS), false, "a parked run is not picked up again until it is due");

    assert.deepEqual(await decideAgentAction(summit, call.id, { approve: true, userId: "user_x" }), { ok: false, reason: "That action has already been decided, or isn't in this workspace." }, "another workspace cannot approve it");
    assert.deepEqual(await decideAgentAction(harbor, call.id, { approve: true, userId: "user_op" }), { ok: true });
    assert.equal((await decideAgentAction(harbor, call.id, { approve: false, userId: "user_op" })).ok, false, "a decision is final");
    assert.equal((await allExceptions()).find((e) => e.id === card.id)?.status, "RESOLVED");
    assert.equal((await fresh(run)).status, "QUEUED", "approving wakes the run");

    assert.equal(await drive(run), "done");
    assert.deepEqual(sent, [{ callKey: `${run.id}:s1`, tenantId: harbor.id, to: "Robin", body: "Hi Robin, following up." }]);
    assert.deepEqual(lastToolResults(requests[1]), [{ id: "s1", error: false, content: '{"sent":true}' }]);
    const [decided] = await calls(run);
    assert.equal(decided.status, "DONE");
    assert.equal(decided.decidedById, "user_op");
    sent.length = 0;
  });

  it("lets the brakes win over an approval: shadow mode, or the tool switched off meanwhile", async () => {
    const shadowed = await start();
    const toShadow = script(reply([use("s6", "test_send", { to: "Robin", body: "Hi" })], "tool_use"), reply([text("Recorded.")]));
    assert.equal(await drive(shadowed), "waiting");
    assert.ok((await decideAgentAction(harbor, (await calls(shadowed))[0].id, { approve: true, userId: "user_op" })).ok);
    process.env.AGENTS_MODE = "shadow";
    assert.equal(await drive(shadowed), "done");
    assert.equal(sent.length, 0, "approved, but the deployment is in shadow now");
    assert.equal((await calls(shadowed))[0].status, "PROPOSED");
    assert.match(lastToolResults(toShadow[1])[0].content, /Shadow mode/);

    process.env.AGENTS_MODE = "live";
    const switchedOff = await start();
    script(reply([use("s7", "test_send", { to: "Robin", body: "Hi" })], "tool_use"), reply([text("Could not send.")]));
    assert.equal(await drive(switchedOff), "waiting");
    assert.ok((await decideAgentAction(harbor, (await calls(switchedOff))[0].id, { approve: true, userId: "user_op" })).ok);
    await setAgent({ toolPolicy: { test_send: "off" } });
    assert.equal(await drive(switchedOff), "done");
    assert.equal(sent.length, 0);
    assert.equal((await calls(switchedOff))[0].status, "REFUSED");
  });

  it("tells the agent when a person declines, and does not carry it out", async () => {
    const run = await start();
    const requests = script(reply([use("s2", "test_send", { to: "Robin", body: "Hi" })], "tool_use"), reply([text("Left it.")]));
    assert.equal(await drive(run), "waiting");
    const [call] = await calls(run);
    assert.ok((await decideAgentAction(harbor, call.id, { approve: false, userId: "user_op", note: "They asked not to be texted." })).ok);
    assert.equal(await drive(run), "done");
    assert.equal(sent.length, 0);
    const [result] = lastToolResults(requests[1]);
    assert.equal(result.error, true);
    assert.match(result.content, /declined this: They asked not to be texted\./);
  });

  it("expires an approval nobody decides, and the run carries on without it", async () => {
    const run = await start();
    const requests = script(reply([use("s3", "test_send", { to: "Robin", body: "Hi" })], "tool_use"), reply([text("Nobody approved the text.")]));
    assert.equal(await drive(run), "waiting");
    const [call] = await calls(run);
    mock.timers.enable({ apis: ["Date"], now: Date.now() + APPROVAL_TTL_MS + 60_000 });
    assert.ok((await repository.listDueAgentRuns(new Date(), AGENT_LEASE_MS)).some((r) => r.id === run.id), "a parked run is looked at again");
    assert.equal(await drive(run), "done");
    assert.equal(sent.length, 0);
    assert.equal((await calls(run))[0].status, "EXPIRED");
    assert.match(lastToolResults(requests[1])[0].content, /Nobody approved this/);
    assert.equal((await allExceptions()).find((e) => e.agentToolCallId === call.id)?.status, "RESOLVED");
  });

  it("only records actions in shadow mode, and asks nobody", async () => {
    process.env.AGENTS_MODE = "shadow";
    const run = await start();
    assert.equal(run.autonomy, "SHADOW");
    const before = (await allExceptions()).length;
    const requests = script(reply([use("s4", "test_send", { to: "Robin", body: "Hi" }), use("r1", "test_read", { note: "x" })], "tool_use"), reply([text("Proposed a text.")]));
    assert.equal(await drive(run), "done");
    assert.equal(sent.length, 0);
    assert.deepEqual((await calls(run)).map((c) => c.status).sort(), ["DONE", "PROPOSED"]);
    const results = lastToolResults(requests[1]);
    assert.match(results[0].content, /Shadow mode/);
    assert.equal(results[0].error, false);
    assert.equal((await allExceptions()).length, before, "no approval was asked for");
  });

  it("never moves money, whatever the workspace allows", async () => {
    await setAgent({ autonomy: "DELEGATED", toolPolicy: { test_pay: "auto" } });
    const run = await start();
    const requests = script(reply([use("p1", "test_pay", { cents: 5000 })], "tool_use"), reply([text("Could not pay.")]));
    assert.equal(await drive(run), "done");
    const [result] = lastToolResults(requests[1]);
    assert.equal(result.error, true);
    assert.match(result.content, /money/);
    assert.equal((await calls(run))[0].status, "REFUSED");
  });

  it("stops a run whose agent is switched off, and closes its open approvals", async () => {
    const run = await start();
    script(reply([use("s5", "test_send", { to: "Robin", body: "Hi" })], "tool_use"));
    assert.equal(await drive(run), "waiting");
    const [call] = await calls(run);
    await setAgent({ enabled: false });
    await repository.updateAgentRun(harbor.id, run.id, { nextStepAt: new Date() });
    assert.equal(await drive(run), "cancelled");
    assert.equal((await fresh(run)).status, "CANCELLED");
    assert.equal((await calls(run))[0].status, "EXPIRED");
    assert.equal((await allExceptions()).find((e) => e.agentToolCallId === call.id)?.status, "RESOLVED");
  });
});

describe("when something goes wrong", () => {
  it("retries a failed step later without running finished tool calls or calling Claude again", async () => {
    flakyFailures = 1;
    const readsBefore = reads;
    const run = await start();
    const requests = script(reply([use("r2", "test_read", { note: "x" }), use("f1", "test_flaky", {})], "tool_use"), reply([text("Updated.")]));
    assert.equal(await drive(run), "retrying");
    const parked = await fresh(run);
    assert.equal(parked.status, "QUEUED");
    assert.equal(parked.attempts, 1);
    assert.equal(parked.error, "provider down");
    assert.ok(parked.nextStepAt.getTime() > Date.now(), "it waits before trying again");
    assert.deepEqual((await calls(run)).map((c) => [c.toolUseId, c.status]).sort(), [["f1", "PENDING"], ["r2", "DONE"]]);

    await repository.updateAgentRun(harbor.id, run.id, { nextStepAt: new Date() });
    assert.equal(await drive(run), "done");
    assert.equal(reads - readsBefore, 1, "the read that finished was not run again");
    assert.equal(requests.length, 2, "the turn that asked for the tools was not asked for again");
    assert.equal((await fresh(run)).attempts, 0);
  });

  it("fails a run whose steps keep failing, and tells a person", async () => {
    const run = await start();
    script(new Error("socket hang up"), new Error("socket hang up"), new Error("socket hang up"));
    for (const expected of ["retrying", "retrying", "failed"]) {
      await repository.updateAgentRun(harbor.id, run.id, { nextStepAt: new Date() });
      assert.equal(await drive(run), expected);
    }
    const failed = await fresh(run);
    assert.equal(failed.status, "FAILED");
    assert.match(failed.error ?? "", /kept failing \(socket hang up\)/);
    assert.ok((await allExceptions()).some((e) => e.agentRunId === run.id && /stopped before finishing/.test(e.reason)));
  });

  it("does not retry a request the API rejects", async () => {
    const run = await start();
    script(Anthropic.APIError.generate(400, { type: "error", error: { type: "invalid_request_error", message: "bad request" } }, "bad request", new Headers()));
    assert.equal(await drive(run), "failed");
  });

  it("fails on a refusal, and on a reply that is cut off twice", async () => {
    const refused = await start();
    script(reply([], "refusal", { stop_details: { type: "refusal", category: "cyber", explanation: null } }));
    assert.equal(await drive(refused), "failed");
    assert.match((await fresh(refused)).error ?? "", /declined to carry on with this \(cyber\)/);

    const cut = await start();
    const requests = script(reply([text("Part")], "max_tokens"), reply([text("Part")], "max_tokens"));
    assert.equal(await drive(cut), "failed");
    assert.deepEqual(requests.map((r) => r.max_tokens), [8192, 16_000], "one more try with more room");
    assert.equal((await repository.listAgentMessages(harbor.id, cut.id)).length, 1, "a cut-off turn is not kept");
  });

  it("stops at the step limit, the run's token cap and the month's budget", async () => {
    const looping = await start();
    const requests = script(...Array.from({ length: MAX_AGENT_STEPS + 1 }, (_, i) => reply([use(`loop_${i}`, "test_read", { note: String(i) })], "tool_use")));
    assert.equal(await drive(looping), "failed");
    assert.equal(requests.length, MAX_AGENT_STEPS);
    assert.match((await fresh(looping)).error ?? "", new RegExp(`limit of ${MAX_AGENT_STEPS} steps`));

    await setAgent({ runTokenCap: 1000 });
    const capped = await start();
    const one = script(reply([use("c1", "test_read", { note: "x" })], "tool_use"), reply([text("unused")]));
    assert.equal(await drive(capped), "failed");
    assert.equal(one.length, 1);
    assert.match((await fresh(capped)).error ?? "", /used its 1,000 tokens/);

    await setAgent({ runTokenCap: null, monthlyBudgetMicros: 1 });
    const refused = await startAgentRun({ tenant: harbor, roleKey: ROLE, trigger: "test", task: "x" });
    assert.equal(refused.ok, false);
    assert.match(refused.ok ? "" : refused.reason, /Test Agent has used this month's/);
  });
});

describe("workspaces", () => {
  it("keep their runs, transcripts and tool calls to themselves", async () => {
    const run = await start();
    script(reply([use("r3", "test_read", { note: "x" })], "tool_use"), reply([text("ok")]));
    assert.equal(await drive(run), "done");
    const [call] = await calls(run);
    assert.equal((call.result as { tenant: string }).tenant, harbor.id, "the tool ran in the run's workspace");
    assert.equal(await repository.findAgentRun(summit.id, run.id), null);
    assert.deepEqual(await repository.listAgentMessages(summit.id, run.id), []);
    assert.deepEqual(await repository.listAgentToolCalls(summit.id, run.id), []);
    assert.equal(await repository.findAgentToolCall(summit.id, call.id), null);
    assert.ok(!(await repository.listAgentRuns(summit.id)).some((r) => r.id === run.id));
    await assert.rejects(repository.createAgentRun(summit.id, { roleKey: ROLE, trigger: "test", autonomy: "SHADOW", model: "claude-opus-5-5", leadId: ours.id, opening: [] }), /Lead/);
  });
});
