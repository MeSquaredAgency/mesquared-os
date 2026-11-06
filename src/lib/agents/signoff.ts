import { checkCompliance } from "@/lib/content/compliance";
import { repository } from "@/lib/data";
import type { BrandProfileRecord, ComplianceIssue, TenantSummary } from "@/lib/types";
import { AGENT_SIGNOFF_RULE } from "./rules";
import type { AgentTool } from "./tool";

/**
 * What a customer would read, checked before anyone is asked to approve it,
 * the same way content is: banned phrases and hype go back to the agent to
 * rewrite, and a price or a claim (or a reason the agent gives itself, such
 * as answering a complaint) means only the client may approve it. Naming a
 * person is normal in a one-to-one message, so it is not a reason here.
 */

export { AGENT_SIGNOFF_RULE };

const BLOCKS: ReadonlySet<ComplianceIssue["code"]> = new Set(["BANNED_PHRASE", "HYPE"]);
const SIGNOFF: ReadonlySet<ComplianceIssue["code"]> = new Set(["PRICE", "CLAIM", "STALE_NUMBER"]);

export interface CustomerTextCheck {
  /** Why it can't go as written; the agent is told and may rewrite it. */
  blocked: string | null;
  /** Why only the client may approve it. */
  signoff: string | null;
}

export function checkCustomerText(tool: AgentTool, input: unknown, ctx: { tenant: Pick<TenantSummary, "name">; brand: BrandProfileRecord | null }): CustomerTextCheck {
  const declared = tool.signoffReasons?.(input) ?? [];
  const text = tool.customerText?.(input);
  const issues = text ? checkCompliance({ text, platform: null, brand: ctx.brand, tenant: ctx.tenant }).issues : [];
  const blocks = issues.filter((i) => BLOCKS.has(i.code)).map((i) => i.message);
  const signoff = [...new Set([...declared, ...issues.filter((i) => SIGNOFF.has(i.code)).map((i) => i.message)])];
  return { blocked: blocks.length ? blocks.join(" ") : null, signoff: signoff.length ? signoff.join(" ") : null };
}

/** The client person who signs off agent messages: named by the workspace's escalation rules, and still a member. */
export async function signoffApprover(tenant: Pick<TenantSummary, "id" | "escalationRules">): Promise<{ userId: string; email: string; name: string | null } | null> {
  const rule = tenant.escalationRules.find((r) => r.when === AGENT_SIGNOFF_RULE) ?? tenant.escalationRules.find((r) => r.when === "*");
  if (!rule?.notifyUserId) return null;
  const member = (await repository.listTenantPeople(tenant.id)).find((p) => p.via === "member" && p.userId === rule.notifyUserId);
  return member ? { userId: member.userId, email: member.email, name: member.name } : null;
}
