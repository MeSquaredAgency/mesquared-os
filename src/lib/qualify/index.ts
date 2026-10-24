import { aiGatewayConfig } from "@/lib/neon";
import type { Qualifier } from "./types";
import { ruleBasedQualifier } from "./rules";

export * from "./types";
export { scoreLead, ruleBasedQualifier, GREEN_THRESHOLD } from "./rules";

export type QualifierEngine = "neon-ai-gateway" | "anthropic" | "rules";

/**
 * Which engine qualifies leads in this deployment. The first configured one
 * wins: Claude through the branch's Neon AI Gateway, then Claude with a
 * direct ANTHROPIC_API_KEY, then the deterministic rule stub. Set
 * QUALIFIER_ENGINE to pin one (it still needs that engine's credentials).
 */
export function qualifierEngine(env: Record<string, string | undefined> = process.env): QualifierEngine {
  const gateway = Boolean(aiGatewayConfig(env));
  const direct = Boolean(env.ANTHROPIC_API_KEY);
  const pinned = env.QUALIFIER_ENGINE?.trim();
  if (pinned === "rules") return "rules";
  if (pinned === "anthropic" && direct) return "anthropic";
  if (pinned === "neon-ai-gateway" && gateway) return "neon-ai-gateway";
  if (gateway) return "neon-ai-gateway";
  if (direct) return "anthropic";
  return "rules";
}

let cached: Qualifier | null = null;

/** Picks the qualifier for this deployment (see qualifierEngine) and caches it. */
export async function getQualifier(): Promise<Qualifier> {
  if (cached) return cached;
  const engine = qualifierEngine();
  if (engine === "neon-ai-gateway") {
    const gateway = aiGatewayConfig();
    const { createAnthropicQualifier } = await import("./anthropic");
    // The Anthropic SDK appends /v1/messages itself, so the gateway's native dialect lives at <host>/anthropic.
    cached = createAnthropicQualifier({ apiKey: gateway!.apiKey, baseURL: `${gateway!.baseURL}/anthropic`, via: "neon-ai-gateway" });
  } else if (engine === "anthropic") {
    const { createAnthropicQualifier } = await import("./anthropic");
    cached = createAnthropicQualifier();
  } else {
    cached = ruleBasedQualifier;
  }
  return cached;
}

/** Exposed for tests. */
export function _resetQualifier() {
  cached = null;
}
