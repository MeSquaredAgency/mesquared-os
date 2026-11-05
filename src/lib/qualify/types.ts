import type { LeadSource, QualificationRules, TicketType } from "@/lib/types";

/** The subset of a lead the qualification engine needs. Pure data, no DB types. */
export interface QualificationInput {
  source: LeadSource;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  message?: string | null;
  /** Normalised form answers: budget, timeline, service, etc. */
  attributes: Record<string, unknown>;
}

export interface QualificationResult {
  ticketType: TicketType;
  /** 0–100. ≥ 60 is GREEN by default. */
  intentScore: number;
  reason: string;
  /** Which engine produced the result, e.g. "stub" or "anthropic:claude-opus-5-5". */
  classifier: string;
  /** Signals the engine matched, useful for operator review. */
  signals: string[];
}

/** Who the lead belongs to, so the Claude call lands on that workspace's usage ledger. */
export interface QualifyContext {
  tenantId: string;
}

export interface Qualifier {
  readonly name: string;
  qualify(input: QualificationInput, rules: QualificationRules, ctx?: QualifyContext): Promise<QualificationResult>;
}
