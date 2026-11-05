import { moduleOn } from "@/lib/modules/registry";
import type { AgentToolOverride, TenantModuleRecord } from "@/lib/types";
import type { AgentRoleDefinition } from "../roles";
import type { AgentTool } from "../tool";
import { getLead, listMissedOpportunities, listOpenExceptions } from "./workspace";

/** Every tool an agent can be offered. A role's own list picks from these. */
export const AGENT_TOOLS: AgentTool[] = [getLead, listMissedOpportunities, listOpenExceptions] as AgentTool[];

export const TOOL_BY_NAME: Record<string, AgentTool> = Object.fromEntries(AGENT_TOOLS.map((t) => [t.name, t]));

/**
 * The tools a run is shown: the role's list, minus tools whose module is off and tools the tenant switched off. A
 * tool the model was never shown cannot be called; the policy refuses it anyway if it tries.
 */
export function offeredTools(role: AgentRoleDefinition, modules: Pick<TenantModuleRecord, "moduleKey" | "enabled">[], toolPolicy: Record<string, AgentToolOverride>): AgentTool[] {
  return role.tools.map((name) => TOOL_BY_NAME[name]).filter((t): t is AgentTool => Boolean(t) && (t.module === null || moduleOn(modules, t.module)) && toolPolicy[t.name] !== "off");
}
