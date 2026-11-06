import Anthropic from "@anthropic-ai/sdk";
import { repository } from "@/lib/data";
import { errorText, log } from "@/lib/log";
import type { AiFeature } from "./models";
import { costMicros } from "./prices";

/**
 * The one way the app talks to Claude. `claudeClient` builds (and reuses) the
 * SDK client; `recordClaudeUsage` writes the ledger row every call owes, with
 * its cost, so spend can be read per tenant and per feature, and returns that
 * cost. Recording never throws: a ledger failure is logged and the caller
 * carries on.
 */

export interface ClaudeClientOptions {
  /** Defaults to ANTHROPIC_API_KEY. */
  apiKey?: string;
  /** Alternative API host, e.g. the Neon AI Gateway's `<host>/anthropic`. */
  baseURL?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

const clients = new Map<string, Anthropic>();
let testClient: Anthropic | null = null;

export function claudeClient(opts: ClaudeClientOptions = {}): Anthropic {
  if (testClient) return testClient;
  const key = JSON.stringify([opts.apiKey ?? null, opts.baseURL ?? null, opts.timeoutMs ?? null, opts.maxRetries ?? null]);
  let client = clients.get(key);
  if (!client) {
    client = new Anthropic({
      ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
      ...(opts.timeoutMs ? { timeout: opts.timeoutMs } : {}),
      ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
    });
    clients.set(key, client);
  }
  return client;
}

/** The parts of a Messages API response the ledger reads. */
export interface ClaudeResponseLike {
  model?: string;
  stop_reason?: string | null;
  usage?: Partial<Anthropic.Usage> | null;
  _request_id?: string | null;
}

export interface ClaudeCall {
  tenantId: string | null | undefined;
  /** An agent's calls are recorded per role, e.g. "agent:customer_relations". */
  feature: Exclude<AiFeature, "agent"> | `agent:${string}`;
  /** The model requested; the response's own model wins when it names one. */
  model: string;
  /** Date.now() when the request was sent. */
  startedAt: number;
}

/** Returns the call's cost in millionths of a US dollar; 0 when the model has no price. */
export async function recordClaudeUsage(call: ClaudeCall, response: ClaudeResponseLike): Promise<number> {
  if (!call.tenantId) {
    log("warn", "ai.usage_untenanted", { feature: call.feature });
    return 0;
  }
  const usage = response.usage ?? {};
  const cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
  const cacheWrite1hTokens = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const tokens = {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWrite1hTokens,
    cacheWrite5mTokens: Math.max(0, cacheWriteTokens - cacheWrite1hTokens),
  };
  const model = response.model || call.model;
  const cost = costMicros(model, tokens);
  if (cost === null) log("warn", "ai.price_unknown", { tenantId: call.tenantId, feature: call.feature, model });
  try {
    await repository.recordAiUsage(call.tenantId, {
      feature: call.feature,
      model,
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      cacheWriteTokens,
      cacheReadTokens: tokens.cacheReadTokens,
      costMicros: cost ?? 0,
      latencyMs: Math.max(0, Date.now() - call.startedAt),
      stopReason: response.stop_reason ?? null,
      requestId: response._request_id ?? null,
    });
  } catch (error) {
    log("error", "ai.usage_record_failed", { tenantId: call.tenantId, feature: call.feature, message: errorText(error) });
  }
  return cost ?? 0;
}

/** Tests swap in a scripted client; pass null to restore the real one. */
export function _setClaudeClientForTests(client: unknown) {
  testClient = client as Anthropic | null;
  clients.clear();
}
