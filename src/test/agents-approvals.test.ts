import assert from "node:assert/strict";
import { after, afterEach, before, describe, it } from "node:test";
import { z } from "zod";
import { _setClaudeClientForTests } from "@/lib/ai/claude";
import { AGENT_LEASE_MS, APPROVAL_TTL_MS, addAgentGuidance, cancelAgentRun, decideAgentAction, driveAgentRun, pauseAgentRun, resumeAgentRun, startAgentRun, takeOverAgentRun } from "@/lib/agents/runtime";
import { ROLE_BY_KEY } from "@/lib/agents/roles";
import { defineTool, type AgentTool } from "@/lib/agents/tool";
import { TOOL_BY_NAME } from "@/lib/agents/tools";
import { buildTimeline, loadApprovalViews, loadRunPage } from "@/lib/agents/views";
import { closeExceptionsInBulk, isOpenAgentApproval, settleException } from "@/lib/console/resolve";
import { repository } from "@/lib/data";
import { demoTenants } from "@/lib/data/fixtures";
import type { AgentRunRecord } from "@/lib/types";

const [harbor, summit] = demoTenants;
const ROLE = "test_approvals";

// --- test tools ------------------------------------------------------------------------

const sent: { callKey: string; to: string; body: string }[] = [];
const testTools: AgentTool[] = [
  defineTool({
    name: "test_text",
    description: "Texts a customer.",
    input: z.object({ to: z.string(), body: z.string().min(1).max(320), reason: z.string() }),
    risk: "external",
    module: null,
    preview: (input) => ({ title: `text ${input.to}`, body: input.body }),
    editable: { field: "body", label: "Message" },
    async run(ctx, input) {
      sent.push({ callKey: ctx.callKey, to: input.to, body: input.body });
      return { sent: true };
    },
  }),
  defineTool({ name: "test_email", description: "Emails a customer.", input: z.object({ to: z.string() }), risk: "external", module: null, run: async () => ({ sent: true }) }),
  defineTool({ name: "test_note", description: "Reads a note.", input: z.object({}), risk: "read", module: null, run: async () => ({ note: "Prefers calls after 5pm." }) }),
] as AgentTool[];

// --- a scripted Claude -----------------------------------------------------------------

let n = 0;
const usage = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null };
const reply = (content: Record<string, unknown>[], stop_reason = "end_turn") => ({ id: `msg_${++n}`, type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason, stop_sequence: null, stop_details: null, usage, _request_id: `req_${n}` });
const text = (t: string) => ({ type: "text", text: t, citations: null });
const thinking = (t: string) => ({ type: "thinking", thinking: t, signature: `sig_${t.length}` });
const toolUse = (id: string, name: string, input: Record<string, unknown>) => ({ type: "tool_use", id, name, input });
const textRobin = (id: string, body = "Hi Robin, can we book your appraisal?") => toolUse(id, "test_text", { to: "Robin", body, reason: "Robin asked for an appraisal two days ago and nobody has replied." });

type Req = { messages: { role: string; content: Record<string, unknown>[] }[]; system: { text: string }[] };

function script(...answers: unknown[]): Req[] {
  const requests: Req[] = [];
  _setClaudeClientForTests({
    messages: {
      async create(params: Req) {
        requests.push(structuredClone(params));
        const next = answers.shift();
        if (typeof next === "function") return (next as () => unknown)();
        if (!next) throw new Error("no scripted answer left");
        return next;
      },
    },
  });
  return requests;
}

async function start(task = "Follow up with Robin."): Promise<AgentRunRecord> {
  const out = await startAgentRun({ tenant: harbor, roleKey: ROLE, trigger: "test", task });
  assert.ok(out.ok, out.ok ? "" : out.reason);
  return out.run;
}

async function drive(run: AgentRunRecord) {
  assert.ok(await repository.claimAgentRun(run.id, new Date(), AGENT_LEASE_MS), "the run is due and free");
  return driveAgentRun(run.id, run.tenantId, Date.now() + 10_000);
}

/** A run parked on one text to Robin. */
async function parked(id: string, body?: string) {
  const run = await start();
  const requests = script(reply([textRobin(id, body)], "tool_use"));
  assert.equal(await drive(run), "waiting");
  const [call] = await repository.listAgentToolCalls(harbor.id, run.id);
  const exception = (await repository.listExceptions([harbor.id], { limit: 500 })).find((e) => e.agentToolCallId === call.id)!;
  assert.ok(exception);
  return { run, call, exception, requests };
}

const fresh = async (run: AgentRunRecord) => (await repository.findAgentRun(run.tenantId, run.id))!;
const callOf = async (run: AgentRunRecord) => (await repository.listAgentToolCalls(run.tenantId, run.id))[0];
const exceptionById = async (id: string) => repository.findException(harbor.id, id);

before(async () => {
  process.env.AGENTS_MODE = "live";
  process.env.MESSAGING_MODE = "log";
  for (const t of testTools) TOOL_BY_NAME[t.name] = t;
  ROLE_BY_KEY[ROLE] = { key: ROLE, name: "Test Relations", responsibilities: "Tests approvals.", tools: ["test_text", "test_email", "test_note"], maxAutonomy: "SUPERVISED", canDelegateTo: [] };
  await repository.upsertTenantAgent(harbor.id, ROLE, { enabled: true, autonomy: "SUPERVISED" }, null);
});

after(() => {
  for (const t of testTools) delete TOOL_BY_NAME[t.name];
  delete ROLE_BY_KEY[ROLE];
  _setClaudeClientForTests(null);
});

afterEach(() => {
  sent.length = 0;
});

describe("an approval card", () => {
  it("shows what would happen, why the agent wants it, and what may be edited", async () => {
    const { run, call, exception } = await parked("c1");
    const views = await loadApprovalViews([exception]);
    const view = views[exception.id];
    assert.ok(view, "the queue item gets a card");
    assert.equal(view.toolCallId, call.id);
    assert.equal(view.runId, run.id);
    assert.equal(view.agentName, "Test Relations");
    assert.equal(view.title, "text Robin");
    assert.equal(view.body, "Hi Robin, can we book your appraisal?");
    assert.equal(view.why, "Robin asked for an appraisal two days ago and nobody has replied.");
    assert.equal(view.policy, "A person approves anything a customer will see.");
    assert.deepEqual(view.edit, { label: "Message", value: "Hi Robin, can we book your appraisal?" });
    assert.equal(view.expiresAt.getTime(), call.createdAt.getTime() + APPROVAL_TTL_MS);
    await cancelAgentRun(harbor, run.id, "test over.");
    assert.deepEqual(await loadApprovalViews([exception]), {}, "a decided approval has no card");
  });

  it("cannot be closed by the queue's generic buttons, one at a time or in bulk", async () => {
    const { run, call, exception } = await parked("c2");
    const plain = await repository.createException(harbor.id, { reason: "Approvals test: a plain item" });
    assert.equal(await settleException(harbor.id, exception.id, "Sorted", true, "user_op"), null);
    assert.equal(await repository.resolveException(harbor.id, exception.id, "Sorted"), null, "the repository refuses too");
    assert.equal(await isOpenAgentApproval(harbor.id, exception.id), true);

    const bulk = await closeExceptionsInBulk(new Set([harbor.id]), [{ tenantId: harbor.id, exceptionId: exception.id }, { tenantId: harbor.id, exceptionId: plain.id }], "Tidying up", "user_op");
    assert.deepEqual(bulk, { closedIds: [plain.id], alreadyResolved: 0, outsidePortfolio: 0, agentApprovals: 1 });
    assert.equal((await exceptionById(exception.id))?.status, "OPEN");
    assert.equal((await callOf(run)).status, "AWAITING_APPROVAL", "the agent is still waiting for a real decision");

    assert.ok((await decideAgentAction(harbor, call.id, { approve: false, userId: "user_op" })).ok);
    assert.equal(await isOpenAgentApproval(harbor.id, exception.id), false);
  });
});

describe("deciding", () => {
  it("runs a person's edit instead of the draft, tells the agent what changed, and keeps the draft in the transcript", async () => {
    const { run, call, exception } = await parked("e1");
    const requests = script(reply([text("Sent the edited text.")]));
    const edit = "Hi Robin, it's Sam from Harbor. Would Thursday at 4 suit for the appraisal?";
    assert.deepEqual(await decideAgentAction(harbor, call.id, { approve: true, userId: "user_op", edit }), { ok: true });
    const decided = await callOf(run);
    assert.equal(decided.status, "APPROVED");
    assert.deepEqual(decided.editedInput, { ...call.input, body: edit });
    assert.equal((await exceptionById(exception.id))?.status, "RESOLVED");

    assert.equal(await drive(run), "done");
    assert.deepEqual(sent, [{ callKey: `${run.id}:e1`, to: "Robin", body: edit }], "the edit is what went out, under the same idempotency key");
    const results = requests[0].messages.at(-1)!.content;
    assert.equal(results[0].type, "tool_result");
    assert.match(String(results[0].content), /A person edited this before it ran\. What they changed: \{"body":"Hi Robin, it's Sam/);
    assert.match(String(results[0].content), /Result: \{"sent":true\}/);
    const transcript = await repository.listAgentMessages(harbor.id, run.id);
    const asked = transcript.flatMap((m) => m.content).find((b) => b.type === "tool_use") as { input: { body: string } };
    assert.equal(asked.input.body, "Hi Robin, can we book your appraisal?", "the model's own turn is never rewritten");
    assert.equal((await callOf(run)).input.body, "Hi Robin, can we book your appraisal?");
  });

  it("refuses an edit the tool would reject, or one it does not allow, and leaves the action waiting", async () => {
    const { run, call } = await parked("e2");
    const tooLong = await decideAgentAction(harbor, call.id, { approve: true, userId: "user_op", edit: "x".repeat(400) });
    assert.equal(tooLong.ok, false);
    assert.match(tooLong.ok ? "" : tooLong.reason, /That message can't be used/);
    assert.equal((await callOf(run)).status, "AWAITING_APPROVAL");

    // Approving with the text unchanged is a plain approval.
    assert.ok((await decideAgentAction(harbor, call.id, { approve: true, userId: "user_op", edit: " Hi Robin, can we book your appraisal? " })).ok);
    assert.equal((await callOf(run)).editedInput, null);
    await cancelAgentRun(harbor, run.id, "test over.");

    const emailRun = await start();
    script(reply([toolUse("e3", "test_email", { to: "robin@example.com" })], "tool_use"));
    assert.equal(await drive(emailRun), "waiting");
    const notEditable = await decideAgentAction(harbor, (await callOf(emailRun)).id, { approve: true, userId: "user_op", edit: "something else" });
    assert.deepEqual(notEditable, { ok: false, reason: "This action can only be approved or declined as it is." });
    await cancelAgentRun(harbor, emailRun.id, "test over.");
  });

  it("lets a person take the work over: nothing is done and the run stops", async () => {
    const { run, call, exception } = await parked("t1");
    assert.equal((await takeOverAgentRun(summit, call.id, "user_x")).ok, false, "not from another workspace");
    assert.deepEqual(await takeOverAgentRun(harbor, call.id, "user_op"), { ok: true, runId: run.id });
    const stopped = await fresh(run);
    assert.equal(stopped.status, "CANCELLED");
    assert.equal(stopped.summary, "a person took the work over.");
    const taken = await callOf(run);
    assert.equal(taken.status, "REJECTED");
    assert.equal(taken.decidedById, "user_op");
    assert.equal((await exceptionById(exception.id))?.status, "RESOLVED");
    assert.equal(sent.length, 0);
    assert.equal((await decideAgentAction(harbor, call.id, { approve: true, userId: "user_op" })).ok, false, "and it cannot be approved afterwards");
  });

  it("won't approve something that expired while nobody stepped the run, and tells the agent it lapsed", async () => {
    const { run, call, exception } = await parked("x1");
    assert.ok(await pauseAgentRun(harbor, run.id), "paused, so no worker notices the clock");
    const late = new Date(call.createdAt.getTime() + APPROVAL_TTL_MS + 1000);
    const out = await decideAgentAction(harbor, call.id, { approve: true, userId: "user_op" }, late);
    assert.deepEqual(out, { ok: false, reason: "That approval had expired, so nothing was done and the agent has been told." });
    assert.equal((await callOf(run)).status, "EXPIRED");
    assert.equal((await exceptionById(exception.id))?.status, "RESOLVED");
    assert.equal((await fresh(run)).status, "PAUSED", "a paused run stays paused");
    await cancelAgentRun(harbor, run.id, "test over.");
  });
});

describe("pausing", () => {
  it("holds a waiting run through an approval, and carries on when resumed", async () => {
    const { run, call } = await parked("p1");
    assert.ok(await pauseAgentRun(harbor, run.id));
    assert.equal(await pauseAgentRun(harbor, run.id), false, "already paused");
    assert.equal(await pauseAgentRun(summit, run.id), false, "not from another workspace");
    assert.ok((await decideAgentAction(harbor, call.id, { approve: true, userId: "user_op" })).ok);
    assert.equal((await fresh(run)).status, "PAUSED", "approving does not wake a paused run");
    assert.ok(!(await repository.listDueAgentRuns(new Date(), AGENT_LEASE_MS)).some((r) => r.id === run.id), "and no worker picks it up");
    assert.equal(sent.length, 0);

    assert.equal(await resumeAgentRun(summit, run.id), false);
    assert.ok(await resumeAgentRun(harbor, run.id));
    assert.equal((await fresh(run)).status, "QUEUED");
    script(reply([text("Sent.")]));
    assert.equal(await drive(run), "done");
    assert.equal(sent.length, 1);
  });

  it("lets the step in progress finish, then stops before the next, and lets go of the run", async () => {
    const run = await start();
    script(async () => {
      assert.ok(await pauseAgentRun(harbor, run.id), "paused while Claude is answering");
      return reply([toolUse("r1", "test_note", {})], "tool_use");
    });
    assert.equal(await drive(run), "paused");
    const held = await fresh(run);
    assert.equal(held.status, "PAUSED");
    assert.equal(held.lockedAt, null, "the worker let go");
    assert.equal((await repository.listAgentMessages(harbor.id, run.id)).length, 2, "the answer it was waiting for is kept");
    assert.equal((await callOf(run)).status, "PENDING", "the next step did not start");

    assert.ok(await resumeAgentRun(harbor, run.id));
    const requests = script(reply([text("She prefers calls after 5pm.")]));
    assert.equal(await drive(run), "done");
    assert.equal(requests.length, 1);
    assert.equal((await callOf(run)).status, "DONE");
  });

  it("gives a run back to the worker still holding it, rather than to a second worker", async () => {
    const run = await start();
    assert.ok(await repository.claimAgentRun(run.id, new Date(), AGENT_LEASE_MS));
    assert.ok(await pauseAgentRun(harbor, run.id));
    assert.ok(await resumeAgentRun(harbor, run.id));
    assert.equal((await fresh(run)).status, "RUNNING");
    assert.equal(await repository.claimAgentRun(run.id, new Date(), AGENT_LEASE_MS), false, "no one else can claim it");
    script(reply([text("Done.")]));
    assert.equal(await driveAgentRun(run.id, run.tenantId, Date.now() + 10_000), "done");
  });

  it("can still be cancelled while paused", async () => {
    const { run, exception } = await parked("p2");
    assert.ok(await pauseAgentRun(harbor, run.id));
    assert.ok(await cancelAgentRun(harbor, run.id, "a person stopped it."));
    assert.equal((await fresh(run)).status, "CANCELLED");
    assert.equal((await exceptionById(exception.id))?.status, "RESOLVED");
    assert.equal(await resumeAgentRun(harbor, run.id), false);
  });
});

describe("guidance", () => {
  it("reaches the model with the next turn, once, and the cached start of the conversation is unchanged", async () => {
    const run = await start();
    assert.deepEqual(await addAgentGuidance(harbor, run.id, "  Robin prefers a call after 5pm.  ", "user_op"), { ok: true });
    const requests = script(reply([text("Noted: call after 5pm.")]));
    assert.equal(await drive(run), "done");
    const [first] = requests;
    assert.equal(first.messages.length, 1, "the opening and the guidance go as one user turn");
    assert.equal(first.messages[0].content.length, 2);
    assert.match(String(first.messages[0].content[1].text), /<guidance>\nRobin prefers a call after 5pm\.\n<\/guidance>/);
    assert.match(first.system[0].text, /<guidance> tags/);
    const [g] = await repository.listAgentGuidance(harbor.id, run.id);
    assert.equal(g.deliveredSeq, 1, "delivered in turn 1, so it is never sent twice");
    const transcript = await repository.listAgentMessages(harbor.id, run.id);
    assert.deepEqual(transcript.map((m) => m.role), ["user", "user", "assistant"]);
  });

  it("goes after the tool results when the run was waiting, and is refused once the run has finished", async () => {
    const { run, call } = await parked("g1");
    assert.ok((await addAgentGuidance(harbor, run.id, "Mention the Thursday slot.", "user_op")).ok);
    assert.ok((await decideAgentAction(harbor, call.id, { approve: true, userId: "user_op" })).ok);
    const requests = script(reply([text("Sent.")]));
    assert.equal(await drive(run), "done");
    const last = requests[0].messages.at(-1)!.content;
    assert.deepEqual(last.map((b) => b.type), ["tool_result", "text"], "results first, as the API requires, then the guidance");
    assert.match(String(last[1].text), /Mention the Thursday slot\./);

    assert.deepEqual(await addAgentGuidance(harbor, run.id, "Too late.", "user_op"), { ok: false, reason: "That run has finished, so there is nothing left to steer." });
    assert.deepEqual(await addAgentGuidance(summit, run.id, "Not yours.", "user_x"), { ok: false, reason: "That run isn't in this workspace." });
    assert.deepEqual(await addAgentGuidance(harbor, run.id, "   ", "user_op"), { ok: false, reason: "Write the guidance first." });
  });
});

describe("the run timeline", () => {
  it("reads in order: the task, thinking, words, actions with their decisions and edits, and guidance", async () => {
    const run = await start("Follow up with Robin about the appraisal.");
    script(reply([thinking("Robin has waited two days."), text("I'll text Robin."), textRobin("tl1")], "tool_use"));
    assert.equal(await drive(run), "waiting");
    const call = await callOf(run);
    assert.ok((await addAgentGuidance(harbor, run.id, "Use Sam's name.", "user_ops")).ok);
    assert.ok((await decideAgentAction(harbor, call.id, { approve: true, userId: "user_ops", edit: "Hi Robin, Sam here. Thursday at 4?" })).ok);
    script(reply([text("Texted Robin with Sam's wording.")]));
    assert.equal(await drive(run), "done");

    const page = await loadRunPage(harbor.id, run.id);
    assert.ok(page);
    assert.equal(page.status.label, "Done");
    assert.deepEqual(page.timeline.map((e) => e.kind), ["task", "thinking", "said", "action", "guidance", "said"]);
    const [task, thought, said, action, guidance, last] = page.timeline;
    assert.ok(task.kind === "task" && /Follow up with Robin about the appraisal\./.test(task.text));
    assert.ok(thought.kind === "thinking" && thought.text === "Robin has waited two days.");
    assert.ok(said.kind === "said" && said.text === "I'll text Robin.");
    assert.ok(action.kind === "action");
    assert.equal(action.action.title, "Text Robin");
    assert.equal(action.action.label, "Done");
    assert.equal(action.action.body, "Hi Robin, Sam here. Thursday at 4?", "the preview shows what actually ran");
    assert.match(action.action.edited ?? "", /Sam here/);
    assert.match(action.action.result ?? "", /"sent": true/);
    assert.ok(action.action.decidedBy && action.action.decidedBy !== "a person", "decisions are signed with a name");
    assert.ok(guidance.kind === "guidance" && guidance.read && guidance.text === "Use Sam's name.");
    assert.ok(last.kind === "said" && last.text === "Texted Robin with Sam's wording.", "its last words are its summary");

    assert.equal(await loadRunPage(summit.id, run.id), null, "another workspace cannot open it");
  });

  it("shows guidance nobody has read yet at the end, and a call the model made that was never recorded", () => {
    const at = new Date();
    const entries = buildTimeline(
      [
        { id: "m0", runId: "r", seq: 0, role: "user", content: [{ type: "text", text: "Do the thing." }], stopReason: null, createdAt: at },
        { id: "m1", runId: "r", seq: 1, role: "assistant", content: [{ type: "redacted_thinking", data: "x" }, { type: "tool_use", id: "lost", name: "test_note", input: {} }], stopReason: "tool_use", createdAt: at },
      ],
      [],
      [{ id: "g", runId: "r", text: "Hurry.", createdById: "nobody", deliveredSeq: null, createdAt: at }],
      {},
    );
    assert.deepEqual(entries.map((e) => e.kind), ["task", "thinking", "action", "guidance"]);
    assert.ok(entries[1].kind === "thinking" && entries[1].text === null);
    assert.ok(entries[2].kind === "action" && entries[2].action.id === null && entries[2].action.label === "Not recorded");
    assert.ok(entries[3].kind === "guidance" && !entries[3].read && entries[3].by === "a person");
  });
});
