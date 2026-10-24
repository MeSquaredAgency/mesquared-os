import type { ComplianceBlock, Industry, OpportunityValues, QualificationRules, ServiceLevels, StageAdvanceTrigger } from "@/lib/types";

export interface TemplatePipeline {
  key: string;
  name: string;
  isDefault?: boolean;
  stages: { key: string; name: string; advanceOn?: StageAdvanceTrigger; isWon?: boolean; isLost?: boolean; quietAfterDays?: number }[];
}

export interface TemplateRole {
  key: string;
  name: string;
  permissions: import("@/lib/types").Permission[];
}

/**
 * Everything an industry template seeds for a new tenant. Applying one is
 * configuration, never code: a tenant can diverge from it afterwards.
 */
export interface IndustryTemplate {
  key: string;
  industry: Industry;
  name: string;
  roles: TemplateRole[];
  pipelines: TemplatePipeline[];
  qualificationRules: QualificationRules;
  sla: ServiceLevels;
  opportunityValues: OpportunityValues;
  /** Module keys switched on, with optional settings. */
  modules: { key: string; settings?: Record<string, unknown> }[];
  /** Automation keys switched on, with optional settings. */
  automations: { key: string; settings?: Record<string, unknown> }[];
  brand: { voice: string; bannedPhrases: string[]; complianceBlock: ComplianceBlock };
}
