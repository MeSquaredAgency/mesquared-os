/**
 * Anthropic list prices in US dollars per million tokens, from
 * https://platform.claude.com/docs/en/about-claude/pricing (checked
 * 6 November 2026). Dollars per million tokens times tokens is millionths of a
 * dollar, so `costMicros` needs no conversion. When Anthropic changes a price,
 * change it here: ledger rows keep the cost they were recorded with.
 */

import { formatMoney } from "@/lib/utils";

export interface ModelPrice {
  input: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  output: number;
}

interface PriceEntry extends ModelPrice {
  /** A request whose whole prompt (input, cache reads and cache writes) is over this many tokens pays `price` for all of it. */
  longContext?: { overPromptTokens: number; price: ModelPrice };
}

export const PRICES: Record<string, PriceEntry> = {
  "claude-fable-5-1": { input: 10, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 0.25, output: 50 },
  "claude-opus-5-5": { input: 4, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2, output: 20 },
  "claude-sonnet-5-5": { input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1, output: 10 },
  "claude-haiku-5-5": {
    input: 0.1,
    cacheWrite5m: 0.125,
    cacheWrite1h: 0.2,
    cacheRead: 0.01,
    output: 0.5,
    longContext: { overPromptTokens: 100_000, price: { input: 0.5, cacheWrite5m: 0.625, cacheWrite1h: 1, cacheRead: 0.05, output: 2.5 } },
  },
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWrite5mTokens: number;
  cacheWrite1hTokens: number;
}

/** "anthropic.claude-haiku-5-5" (Bedrock) and "claude-haiku-5-5" price the same. */
function priceEntry(model: string): PriceEntry | null {
  return PRICES[model] ?? PRICES[model.replace(/^anthropic\./, "")] ?? null;
}

/** What one call cost in millionths of a US dollar, or null for a model with no price here. */
export function costMicros(model: string, usage: TokenUsage): number | null {
  const entry = priceEntry(model);
  if (!entry) return null;
  const prompt = usage.inputTokens + usage.cacheReadTokens + usage.cacheWrite5mTokens + usage.cacheWrite1hTokens;
  const p = entry.longContext && prompt > entry.longContext.overPromptTokens ? entry.longContext.price : entry;
  return Math.round(
    usage.inputTokens * p.input + usage.cacheWrite5mTokens * p.cacheWrite5m + usage.cacheWrite1hTokens * p.cacheWrite1h + usage.cacheReadTokens * p.cacheRead + usage.outputTokens * p.output,
  );
}

/** "USD 1.23" in the locale's style, or "under USD 0.01" for a fraction of a cent. */
export function formatUsdMicros(micros: number, locale = "en-AU"): string {
  if (micros > 0 && micros < 10_000) return `under ${formatMoney(1, "USD", locale)}`;
  return formatMoney(Math.round(micros / 10_000), "USD", locale);
}
