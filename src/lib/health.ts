import type { PortfolioRow } from "@/lib/types";

/** One reason a workspace lost points, in words an operator can act on. */
export interface HealthDeduction {
  key: "breaches" | "missed" | "exceptions" | "integrations" | "pacing";
  points: number;
  /** "2 SLA breaches", "1 failing integration" */
  label: string;
}

/** The caps keep one bad dimension from hiding another. */
const CAPS = { breaches: 30, missed: 25, exceptions: 20, integrations: 15, pacing: 10 } as const;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Where a workspace's health points went. The portfolio shows the score; this
 * is the sentence behind it ("68: 2 breaches, 1 failing integration"), so an
 * operator knows what to fix first without opening the workspace.
 */
export function healthBreakdown(row: Omit<PortfolioRow, "health">): HealthDeduction[] {
  const out: HealthDeduction[] = [];
  if (row.slaBreaches > 0) out.push({ key: "breaches", points: Math.min(CAPS.breaches, row.slaBreaches * 10), label: plural(row.slaBreaches, "SLA breach", "SLA breaches") });
  if (row.missedOpen > 0) out.push({ key: "missed", points: Math.min(CAPS.missed, row.missedOpen * 5), label: plural(row.missedOpen, "open missed opportunity", "open missed opportunities") });
  if (row.exceptionsOpen > 0) out.push({ key: "exceptions", points: Math.min(CAPS.exceptions, row.exceptionsOpen * 4), label: plural(row.exceptionsOpen, "exception") });
  const failing = row.integrations.filter((i) => i.status === "NEEDS_ATTENTION" || i.status === "DISCONNECTED").length;
  if (failing > 0) out.push({ key: "integrations", points: Math.min(CAPS.integrations, failing * 8), label: plural(failing, "failing integration") });
  const drift = pacingDrift(row.adPacing);
  if (drift !== null && Math.abs(drift) > 0.25) out.push({ key: "pacing", points: CAPS.pacing, label: `ad spend ${drift > 0 ? "over" : "under"} plan by ${Math.round(Math.abs(drift) * 100)}%` });
  return out;
}

/** Spend against where the month says it should be, as a fraction of expected; null without a budget. */
export function pacingDrift(pacing: PortfolioRow["adPacing"]): number | null {
  if (!pacing || pacing.budgetCents <= 0) return null;
  const expected = pacing.budgetCents * (pacing.daysElapsed / pacing.daysInMonth);
  return expected > 0 ? (pacing.spentCents - expected) / expected : null;
}

/**
 * A 0–100 health score for the operator portfolio. Deductions are capped so
 * one bad dimension cannot hide another; the formula is deliberately simple
 * and explained in the console tooltip.
 */
export function healthScore(row: Omit<PortfolioRow, "health">): number {
  const lost = healthBreakdown(row).reduce((sum, d) => sum + d.points, 0);
  return Math.max(0, Math.min(100, Math.round(100 - lost)));
}

export function healthTone(score: number): "good" | "watch" | "bad" {
  if (score >= 80) return "good";
  if (score >= 55) return "watch";
  return "bad";
}
