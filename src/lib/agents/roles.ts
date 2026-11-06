import type { AgentAutonomy } from "@/lib/types";

/**
 * Agent roles, the same split as automations: a role is code, and a tenant's
 * use of it is a TenantAgent row. A role names the only tools it can ever be
 * offered and the most autonomy any tenant may give it. Roles gain tools as
 * the pull requests that build them land.
 */
export interface AgentRoleDefinition {
  key: string;
  name: string;
  /** What the role is for, in the words its system prompt and the settings page share. */
  responsibilities: string;
  /** Tool names it may be offered; a tool not listed does not exist for it. */
  tools: string[];
  /** The most autonomy any tenant may give it. */
  maxAutonomy: AgentAutonomy;
  /** Roles it may hand work to. Specialists hand work to nobody: they report back or ask a person. */
  canDelegateTo: string[];
}

export const AGENT_ROLES: AgentRoleDefinition[] = [
  {
    key: "customer_relations",
    name: "Customer Relations",
    responsibilities:
      "Makes sure nobody who contacted the business is left hanging. Reads each missed opportunity and each reply, writes a call brief for whoever makes the call, drafts the follow-up, and nudges the team when a call is overdue.",
    tools: ["get_lead", "list_missed_opportunities"],
    maxAutonomy: "DELEGATED",
    canDelegateTo: [],
  },
  {
    key: "content",
    name: "Content",
    responsibilities: "Plans a week of posts from the brand, current listings, recent wins and channel numbers, and drafts each one into the approval chain so the client can approve the week in one sitting.",
    // Its planning and drafting tools arrive with the Content agent.
    tools: [],
    maxAutonomy: "SUPERVISED",
    canDelegateTo: [],
  },
  {
    key: "ops_director",
    name: "Operations Director",
    responsibilities:
      "The operator's second in command for one client. Reviews breaches, missed opportunities, the exception queue, content and ad pacing every morning, suggests what to do about each exception, hands work to the specialists or to a person, follows up on work that stalls, and writes the daily brief.",
    tools: ["list_missed_opportunities", "list_open_exceptions", "get_lead"],
    maxAutonomy: "SUPERVISED",
    canDelegateTo: ["customer_relations", "content"],
  },
];

export const ROLE_BY_KEY: Record<string, AgentRoleDefinition> = Object.fromEntries(AGENT_ROLES.map((r) => [r.key, r]));
