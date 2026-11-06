/**
 * Which model does which kind of work. One table, so moving a feature to a
 * cheaper or stronger model is a one-line change with its eval, and every
 * call site reads the same defaults. Each feature keeps an environment
 * variable that overrides the model for a deployment.
 */

export type AiFeature = "qualify" | "content" | "triage" | "agent";

export type AiEffort = "low" | "medium" | "high";

export interface AiRoute {
  model: string;
  effort: AiEffort;
  maxTokens: number;
  /** Request deadline; unset keeps the SDK default. */
  timeoutMs?: number;
  /** Retries after the first try; unset keeps the SDK default. */
  maxRetries?: number;
}

interface RouteDefinition extends AiRoute {
  modelEnv: string;
}

const ROUTES: Record<AiFeature, RouteDefinition> = {
  // The acknowledgement has to leave within the five-minute SLA, so a slow answer falls back to the rule engine: one
  // retry, a short deadline. Stays on Opus until an eval against real leads shows a cheaper model agrees with it.
  qualify: { model: "claude-opus-5-5", effort: "low", maxTokens: 1024, timeoutMs: 8_000, maxRetries: 1, modelEnv: "QUALIFIER_MODEL" },
  content: { model: "claude-opus-5-5", effort: "medium", maxTokens: 4096, modelEnv: "CONTENT_MODEL" },
  // Classifying a comment and drafting two sentences is Haiku's work. Thinking counts toward max_tokens, so leave room.
  triage: { model: "claude-haiku-5-5", effort: "low", maxTokens: 1024, modelEnv: "TRIAGE_MODEL" },
  // One step of an agent run: read what the tools returned, decide, call the next tool or finish. A tenant's agent
  // row can name another model. Non-streaming, so max_tokens stays where an HTTP request will not time out.
  agent: { model: "claude-opus-5-5", effort: "medium", maxTokens: 8192, timeoutMs: 120_000, maxRetries: 2, modelEnv: "AGENT_MODEL" },
};

export function routeFor(feature: AiFeature, env: Record<string, string | undefined> = process.env): AiRoute {
  const { modelEnv, ...route } = ROUTES[feature];
  const model = env[modelEnv]?.trim() || route.model;
  if (feature === "qualify") {
    const timeout = Number.parseInt(env.QUALIFIER_TIMEOUT_MS ?? "", 10);
    if (timeout > 0) return { ...route, model, timeoutMs: timeout };
  }
  return { ...route, model };
}
