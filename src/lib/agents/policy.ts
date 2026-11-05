import type { AgentAutonomy, AgentToolOverride } from "@/lib/types";

/**
 * Whether an agent's tool call runs, waits for a person, is only recorded, or
 * is refused. A pure function of the tool's risk, the run's autonomy, the
 * tenant's override for that tool and the tool's module, so every combination
 * can be tested and nothing in a prompt can change the answer.
 */

/** What a tool can touch. No tools exist for settings, people, permissions, credentials or deletion. */
export type ToolRisk = "read" | "draft" | "internal" | "external" | "financial";

/**
 * run: carry it out. ask: park it for a person to approve. propose: record what the agent would have done and do
 * nothing (shadow). refuse: never, and tell the agent why.
 */
export type ToolDecision = "run" | "ask" | "propose" | "refuse";

/** The deployment switch, like SOCIAL_MODE: off runs no agent at all, shadow forces every agent into SHADOW. */
export type AgentsMode = "off" | "shadow" | "live";

export const AUTONOMY_LEVELS: readonly AgentAutonomy[] = ["SHADOW", "SUGGEST", "SUPERVISED", "DELEGATED"];

export function agentsMode(env: Record<string, string | undefined> = process.env): AgentsMode {
  const mode = env.AGENTS_MODE?.trim();
  return mode === "live" || mode === "shadow" ? mode : "off";
}

/** The tenant's setting, capped by the role's ceiling; SHADOW for everyone unless the deployment is live. */
export function effectiveAutonomy(tenant: AgentAutonomy, roleCeiling: AgentAutonomy, mode: AgentsMode): AgentAutonomy {
  if (mode !== "live") return "SHADOW";
  return AUTONOMY_LEVELS[Math.min(AUTONOMY_LEVELS.indexOf(tenant), AUTONOMY_LEVELS.indexOf(roleCeiling))];
}

const BASE: Record<AgentAutonomy, Record<ToolRisk, ToolDecision>> = {
  SHADOW: { read: "run", draft: "propose", internal: "propose", external: "propose", financial: "refuse" },
  SUGGEST: { read: "run", draft: "run", internal: "ask", external: "ask", financial: "refuse" },
  SUPERVISED: { read: "run", draft: "run", internal: "run", external: "ask", financial: "refuse" },
  DELEGATED: { read: "run", draft: "run", internal: "run", external: "ask", financial: "refuse" },
};

export interface PolicyInput {
  risk: ToolRisk;
  /** The run's effective autonomy (see effectiveAutonomy). */
  autonomy: AgentAutonomy;
  /** The tenant's override for this tool, if any. */
  override?: AgentToolOverride;
  /** Whether the module the tool belongs to is on; true for tools that belong to none. */
  moduleOn: boolean;
}

export interface PolicyDecision {
  decision: ToolDecision;
  /** Why, in words for the run timeline, the approval card and the agent itself. */
  reason: string;
}

export function decideTool({ risk, autonomy, override, moduleOn }: PolicyInput): PolicyDecision {
  if (!moduleOn) return { decision: "refuse", reason: "That part of the platform is switched off for this workspace." };
  if (override === "off") return { decision: "refuse", reason: "This workspace has switched that action off for agents." };
  const base = BASE[autonomy][risk];
  if (base === "refuse") return { decision: "refuse", reason: "No agent may move money or ad spend." };
  if (base === "propose") return { decision: "propose", reason: "Shadow mode: recorded as a proposal, nothing was carried out." };
  // An override can only tighten, except one case: a workspace that has delegated a named customer-facing action.
  // A shadow agent never asks anyone for anything, so there a tightened read is only recorded.
  if (override === "ask" && base === "run") {
    return autonomy === "SHADOW" ? { decision: "propose", reason: "Shadow mode: this workspace wants a person to approve that action, so it was only recorded." } : { decision: "ask", reason: "This workspace wants a person to approve that action." };
  }
  if (override === "auto" && base === "ask" && autonomy === "DELEGATED" && risk === "external") return { decision: "run", reason: "This workspace lets that action go without a person." };
  if (base === "ask") return { decision: "ask", reason: risk === "external" ? "A person approves anything a customer will see." : "Suggest mode: a person approves every change." };
  return { decision: "run", reason: "Within this agent's autonomy." };
}
