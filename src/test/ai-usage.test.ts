import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { _setClaudeClientForTests, recordClaudeUsage } from "@/lib/ai/claude";
import { routeFor } from "@/lib/ai/models";
import { costMicros, formatUsdMicros } from "@/lib/ai/prices";
import { createAnthropicGenerator } from "@/lib/content/generate";
import { repository } from "@/lib/data";
import { demoTenants } from "@/lib/data/fixtures";
import { createAnthropicQualifier } from "@/lib/qualify/anthropic";
import { triageMessage } from "@/lib/social/inbox";

const tenant = demoTenants[0];
const other = demoTenants[1];
const epoch = new Date(0);
const rules = tenant.qualificationRules;

/** A scripted Messages API: records each request and answers with the next scripted response. */
function scriptedClaude(...answers: (object | Error)[]) {
  const requests: Record<string, unknown>[] = [];
  const client = {
    messages: {
      async parse(params: Record<string, unknown>) {
        requests.push(params);
        const next = answers.shift();
        if (!next) throw new Error("no scripted answer left");
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
  _setClaudeClientForTests(client);
  return requests;
}

const answer = (parsed: unknown, over: Record<string, unknown> = {}) => ({
  model: "claude-opus-5-5",
  stop_reason: "end_turn",
  parsed_output: parsed,
  usage: { input_tokens: 600, output_tokens: 120, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, cache_creation: null },
  _request_id: "req_test",
  ...over,
});

const lead = { source: "WEB_FORM" as const, email: "sam@example.com", phone: "0400000000", message: "Can I book an appraisal this week?", attributes: {} };

afterEach(() => _setClaudeClientForTests(null));

describe("prices", () => {
  it("prices input, output and both cache writes at their own rates", () => {
    assert.equal(costMicros("claude-opus-5-5", { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 }), 14_000);
    assert.equal(costMicros("claude-sonnet-5-5", { inputTokens: 2000, outputTokens: 800, cacheReadTokens: 6000, cacheWrite5mTokens: 1000, cacheWrite1hTokens: 0 }), 15_100);
    assert.equal(costMicros("claude-opus-5-5", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 1000 }), 8_000);
  });

  it("moves a whole Haiku request to the long-context price once its prompt passes 100,000 tokens, cache reads included", () => {
    const small = { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 };
    assert.equal(costMicros("claude-haiku-5-5", small), 150);
    assert.equal(costMicros("claude-haiku-5-5", { ...small, inputTokens: 120_000, outputTokens: 1000 }), 62_500);
    assert.equal(costMicros("claude-haiku-5-5", { ...small, outputTokens: 0, cacheReadTokens: 100_000 }), 5_500);
  });

  it("prices a Bedrock model id like the API's, and knows when it has no price", () => {
    const u = { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWrite5mTokens: 0, cacheWrite1hTokens: 0 };
    assert.equal(costMicros("anthropic.claude-haiku-5-5", u), costMicros("claude-haiku-5-5", u));
    assert.equal(costMicros("claude-unknown-9", u), null);
  });

  it("shows dollars to the cent, and a fraction of a cent as under one", () => {
    // Intl puts a non-breaking space between the code and the amount.
    const usd = (micros: number) => formatUsdMicros(micros).replace(/\s/g, " ");
    assert.equal(usd(1_230_000), "USD 1.23");
    assert.equal(usd(4_800), "under USD 0.01");
    assert.equal(usd(0), "USD 0.00");
  });
});

describe("model routing", () => {
  it("keeps qualification on Opus with a short deadline, and moves triage to Haiku", () => {
    assert.deepEqual(routeFor("qualify", {}), { model: "claude-opus-5-5", effort: "low", maxTokens: 1024, timeoutMs: 8_000, maxRetries: 1 });
    assert.equal(routeFor("content", {}).model, "claude-opus-5-5");
    assert.equal(routeFor("triage", {}).model, "claude-haiku-5-5");
  });

  it("lets each feature's own variable override its model, and no other", () => {
    assert.equal(routeFor("triage", { CONTENT_MODEL: "claude-sonnet-5-5" }).model, "claude-haiku-5-5");
    assert.equal(routeFor("triage", { TRIAGE_MODEL: "claude-sonnet-5-5" }).model, "claude-sonnet-5-5");
    assert.equal(routeFor("content", { CONTENT_MODEL: "claude-sonnet-5-5" }).model, "claude-sonnet-5-5");
    assert.equal(routeFor("qualify", { QUALIFIER_MODEL: "claude-haiku-5-5", QUALIFIER_TIMEOUT_MS: "5000" }).timeoutMs, 5_000);
  });
});

describe("the usage ledger", () => {
  it("writes one row for a qualification, on the lead's workspace, with its cost", async () => {
    const before = await repository.sumAiUsage(tenant.id, epoch);
    const otherBefore = await repository.sumAiUsage(other.id, epoch);
    const requests = scriptedClaude(answer({ intent_score: 82, reason: "Wants an appraisal.", signals: ["appraisal"] }));
    const result = await createAnthropicQualifier({ apiKey: "sk-test" }).qualify(lead, rules, { tenantId: tenant.id });
    assert.equal(result.classifier, "anthropic:claude-opus-5-5", "the model answered, not the fallback");
    const after = await repository.sumAiUsage(tenant.id, epoch);
    assert.equal(after.calls, before.calls + 1);
    assert.equal(after.costMicros - before.costMicros, 600 * 4 + 120 * 20);
    assert.deepEqual(await repository.sumAiUsage(other.id, epoch), otherBefore, "another workspace's ledger is untouched");
    assert.equal(requests[0].model, "claude-opus-5-5");
    assert.equal(typeof requests[0].system, "string", "no cache markers on a prompt too short to cache");
  });

  it("writes one row for a content batch and one for a triage, triage on Haiku", async () => {
    const before = await repository.sumAiUsage(tenant.id, epoch);
    const requests = scriptedClaude(
      answer({ drafts: [{ platform: "FACEBOOK", title: "Open home", body: "Open home on Saturday.", hashtags: [], media_brief: "A photo of the front.", claims: [] }] }),
      answer({ intent: "praise", routine: true, suggested_reply: "Thank you!", confidence: 0.9 }, { model: "claude-haiku-5-5" }),
    );
    const drafts = await createAnthropicGenerator().draft({ tenant, brand: null, source: { title: "Open home", text: "Open home on Saturday at 10.", kind: "RAW_TEXT" }, platforms: ["FACEBOOK"] });
    assert.equal(drafts.length, 1);
    const key = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-test";
    try {
      const triage = await triageMessage(tenant, "Love the new listing photos!");
      assert.equal(triage.intent, "praise");
    } finally {
      if (key === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = key;
    }
    const after = await repository.sumAiUsage(tenant.id, epoch);
    assert.equal(after.calls, before.calls + 2);
    assert.equal(requests[1].model, "claude-haiku-5-5");
    assert.equal(after.costMicros - before.costMicros, 600 * 4 + 120 * 20 + (600 * 0.1 + 120 * 0.5));
  });

  it("still records a refusal, which is billed, and records nothing when the call fails", async () => {
    const before = await repository.sumAiUsage(tenant.id, epoch);
    scriptedClaude(answer(null, { stop_reason: "refusal" }), new Error("overloaded"));
    const q = createAnthropicQualifier({ apiKey: "sk-test" });
    const refused = await q.qualify(lead, rules, { tenantId: tenant.id });
    const failed = await q.qualify(lead, rules, { tenantId: tenant.id });
    assert.match(refused.classifier, /llm fallback/);
    assert.match(failed.classifier, /llm fallback/);
    assert.equal((await repository.sumAiUsage(tenant.id, epoch)).calls, before.calls + 1);
  });

  it("never fails the caller when the ledger write fails", async () => {
    const original = repository.recordAiUsage;
    repository.recordAiUsage = async () => {
      throw new Error("database unavailable");
    };
    try {
      scriptedClaude(answer({ intent_score: 82, reason: "Wants an appraisal.", signals: [] }));
      const result = await createAnthropicQualifier({ apiKey: "sk-test" }).qualify(lead, rules, { tenantId: tenant.id });
      assert.equal(result.classifier, "anthropic:claude-opus-5-5", "the model answered, not the fallback");
    } finally {
      repository.recordAiUsage = original;
    }
  });

  it("splits cache writes into 1-hour and 5-minute, and counts only the period asked for", async () => {
    const since = new Date();
    await recordClaudeUsage(
      { tenantId: tenant.id, feature: "content", model: "claude-sonnet-5-5", startedAt: Date.now() },
      { model: "claude-sonnet-5-5", usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 3000, cache_creation: { ephemeral_1h_input_tokens: 1000, ephemeral_5m_input_tokens: 2000 } } },
    );
    const totals = await repository.sumAiUsage(tenant.id, since);
    assert.equal(totals.calls, 1);
    assert.equal(totals.cacheWriteTokens, 3000);
    assert.equal(totals.costMicros, 100 * 2 + 10 * 10 + 1000 * 4 + 2000 * 2.5);
    assert.equal((await repository.sumAiUsage(tenant.id, new Date(Date.now() + 60_000))).calls, 0);
  });
});
