import type { PortfolioRow } from "@/lib/types";

/**
 * A 0–100 health score for the operator portfolio. Deductions are capped so
 * one bad dimension cannot hide another; the formula is deliberately simple
 * and explained in the console tooltip.
 */
export function healthScore(row: Omit<PortfolioRow, "health">): number {
  let score = 100;
  score -= Math.min(30, row.slaBreaches * 10);
  score -= Math.min(25, row.missedOpen * 5);
  score -= Math.min(20, row.exceptionsOpen * 4);
  score -= Math.min(15, row.integrations.filter((i) => i.status === "NEEDS_ATTENTION" || i.status === "DISCONNECTED").length * 8);
  if (row.adPacing) {
    const expected = row.adPacing.budgetCents * (row.adPacing.daysElapsed / row.adPacing.daysInMonth);
    const drift = expected > 0 ? Math.abs(row.adPacing.spentCents - expected) / expected : 0;
    if (drift > 0.25) score -= 10;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function healthTone(score: number): "good" | "watch" | "bad" {
  if (score >= 80) return "good";
  if (score >= 55) return "watch";
  return "bad";
}
