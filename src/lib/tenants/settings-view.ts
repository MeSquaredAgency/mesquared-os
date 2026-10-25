import type { EscalationRule, QualificationRules, TenantBranding, TenantSummary, UserRecord } from "@/lib/types";

/**
 * What the settings studio (a client component) is allowed to see of a
 * tenant: the fields its forms edit, nothing else. `TenantSummary` also
 * carries `settings`, the template key and other internals that never need
 * to reach the browser.
 */
export interface SettingsView {
  id: string;
  name: string;
  branding: TenantBranding;
  sla: TenantSummary["sla"];
  qualificationRules: Pick<QualificationRules, "serviceAreas" | "requirePhone" | "highIntentServices" | "greenCriteria" | "autoHandled">;
  escalationRules: EscalationRule[];
  opportunityValues: TenantSummary["opportunityValues"];
}

export function toSettingsView(tenant: TenantSummary): SettingsView {
  const q = tenant.qualificationRules;
  return {
    id: tenant.id,
    name: tenant.name,
    branding: { ...tenant.branding },
    sla: { ...tenant.sla },
    qualificationRules: { serviceAreas: q.serviceAreas, requirePhone: q.requirePhone, highIntentServices: q.highIntentServices, greenCriteria: q.greenCriteria, autoHandled: q.autoHandled },
    escalationRules: [...tenant.escalationRules],
    opportunityValues: { ...tenant.opportunityValues },
  };
}

/** An operator as the assignment dropdown needs it: no flags, no session data. */
export interface OperatorOption {
  id: string;
  name: string | null;
  email: string;
}

export function toOperatorOption(user: UserRecord): OperatorOption {
  return { id: user.id, name: user.name, email: user.email };
}
