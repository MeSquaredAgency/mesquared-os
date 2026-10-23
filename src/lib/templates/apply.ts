import type { BrandProfileRecord, PipelineRecord, TenantAutomationRecord, TenantModuleRecord, TenantRoleRecord } from "@/lib/types";
import { MODULES } from "@/lib/modules/registry";
import { AUTOMATIONS } from "@/lib/automations/registry";
import type { IndustryTemplate } from "./types";

export interface MaterializedTemplate {
  roles: TenantRoleRecord[];
  pipelines: PipelineRecord[];
  modules: TenantModuleRecord[];
  automations: TenantAutomationRecord[];
  brand: BrandProfileRecord;
}

/**
 * Turns a template into the concrete configuration rows for one tenant.
 * Used by the demo fixtures (with generated ids) and by the seed and the
 * "create tenant" flow (which then persist the rows).
 */
export function materializeTemplate(template: IndustryTemplate, tenantId: string, nextId: (prefix: string) => string): MaterializedTemplate {
  const roles: TenantRoleRecord[] = template.roles.map((r) => ({
    id: nextId("role"),
    tenantId,
    name: r.name,
    templateKey: r.key,
    permissions: r.permissions,
  }));

  const pipelines: PipelineRecord[] = template.pipelines.map((p) => {
    const id = nextId("pipe");
    return {
      id,
      tenantId,
      key: p.key,
      name: p.name,
      isDefault: Boolean(p.isDefault),
      stages: p.stages.map((s, order) => ({
        id: nextId("stage"),
        pipelineId: id,
        key: s.key,
        name: s.name,
        order,
        advanceOn: s.advanceOn ?? "MANUAL",
        isWon: Boolean(s.isWon),
        isLost: Boolean(s.isLost),
      })),
    };
  });

  const enabledModules = new Map(template.modules.map((m) => [m.key, m.settings ?? {}]));
  const modules: TenantModuleRecord[] = MODULES.map((m) => ({
    moduleKey: m.key,
    enabled: enabledModules.has(m.key),
    settings: enabledModules.get(m.key) ?? {},
  }));

  const enabledAutomations = new Map(template.automations.map((a) => [a.key, a.settings ?? {}]));
  const automations: TenantAutomationRecord[] = AUTOMATIONS.map((a) => ({
    typeKey: a.key,
    enabled: enabledAutomations.has(a.key),
    settings: enabledAutomations.get(a.key) ?? {},
  }));

  return {
    roles,
    pipelines,
    modules,
    automations,
    brand: {
      voice: template.brand.voice,
      examples: [],
      bannedPhrases: template.brand.bannedPhrases,
      complianceBlock: template.brand.complianceBlock,
    },
  };
}
