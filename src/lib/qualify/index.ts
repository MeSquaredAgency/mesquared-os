import type { Qualifier } from "./types";
import { ruleBasedQualifier } from "./rules";

export * from "./types";
export { scoreLead, ruleBasedQualifier, GREEN_THRESHOLD } from "./rules";

let cached: Qualifier | null = null;

/**
 * Picks the qualifier for this deployment: the Anthropic-backed engine when a
 * key is configured, otherwise the deterministic stub.
 */
export async function getQualifier(): Promise<Qualifier> {
  if (cached) return cached;
  if (process.env.ANTHROPIC_API_KEY) {
    const { createAnthropicQualifier } = await import("./anthropic");
    cached = createAnthropicQualifier();
  } else {
    cached = ruleBasedQualifier;
  }
  return cached;
}
