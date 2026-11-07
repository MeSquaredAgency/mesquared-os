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
  /** The model the role runs on unless the workspace or the deployment says otherwise. */
  model?: string;
  /** How the role goes about its work, added to its system prompt. */
  guide?: string;
  /** What starts its runs, in words for the console. A role nothing starts yet can't be switched on. */
  startsOn?: string;
}

export const AGENT_ROLES: AgentRoleDefinition[] = [
  {
    key: "customer_relations",
    name: "Customer Relations",
    responsibilities:
      "Makes sure nobody who contacted the business is left hanging. Reads each missed opportunity and each reply, writes a call brief for whoever makes the call, drafts the follow-up, and nudges the team when a call is overdue.",
    tools: ["get_missed_opportunity", "get_lead", "get_conversation", "find_listing", "list_team", "write_call_brief", "add_lead_note", "remind_team_to_call", "assign_lead", "escalate_to_person", "send_message"],
    maxAutonomy: "DELEGATED",
    canDelegateTo: [],
    // Reading, judging and short writing: Sonnet is enough, at about half Opus's price.
    model: "claude-sonnet-5-5",
    startsOn: "Each missed opportunity about a lead, and each reply from someone with an open lead.",
    guide: [
      "How you work:",
      "- Start with the lead (get_lead), what has been said (get_conversation) and, for a property enquiry, the listing they mean (find_listing).",
      "- Always write a call brief (write_call_brief). Whoever calls will read it on a phone just before dialling: who they are, what they want, the property, a natural first line, and anything to be careful about.",
      "- This business works call-first: a call from a person is the answer, and a message only supports it. Draft a message (send_message) only when it moves things on: to say someone will call and when, to offer times, or because they asked to be texted. Never send one that only repeats an automatic reply they already had. One message per run at most.",
      "- If they are still waiting for a call, remind the team (remind_team_to_call; 0 minutes is now). Assign the lead (assign_lead) only when the right person is clear from list_team.",
      "- Never state a fact about a property that find_listing did not return, and never quote a price, a fee or availability you cannot see. Saying when someone will call is fine. Don't promise anything else (an outcome, a date, a repair), argue with a complaint, or say anything legal: flag it on the message so the client signs it off, or escalate_to_person.",
      "- If a message is declined, don't send another; say in your summary what a person should do instead.",
    ].join("\n"),
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
