import { checkCompliance } from "@/lib/content/compliance";
import { repository } from "@/lib/data";
import type { BrandProfileRecord, ComplianceIssue, TenantSummary } from "@/lib/types";
import { AGENT_SIGNOFF_RULE } from "./rules";
import type { AgentTool } from "./tool";

/**
 * What a customer would read, checked on the server before anyone is asked
 * to approve it, again when a person edits it, and again right before it
 * goes. Banned phrases and hype go back to the agent. A price or a claim (the
 * content checks), a promise in the text, a legal point in the text or in
 * what they wrote, or a reply to someone who complained means only the
 * client may approve it, whether or not the agent flagged it. Saying when
 * someone will get in touch ("someone will call you this afternoon") is the
 * one promise an operator may approve: the business's own automatic reply
 * already makes it, and the call-first chase follows it up. It still always
 * needs a person, as does anything else that might commit the business that
 * the patterns can't rule out (a time, a number, "we will"), even where a
 * workspace lets messages go alone. Naming a person is normal in a one-to-one
 * message, so it is not a reason here.
 */

export { AGENT_SIGNOFF_RULE };

const BLOCKS: ReadonlySet<ComplianceIssue["code"]> = new Set(["BANNED_PHRASE", "HYPE"]);
const SIGNOFF: ReadonlySet<ComplianceIssue["code"]> = new Set(["PRICE", "CLAIM", "STALE_NUMBER"]);

const WILL = String.raw`(?:'ll|’ll|\s+will|\s+shall|\s+(?:am|are|is)\s+going\s+to|'re\s+going\s+to|’re\s+going\s+to)`;
/** Someone undertakes to do something: "I'll call you tomorrow", "someone will be in touch", "we guarantee". */
const PROMISE = new RegExp(
  String.raw`\b(?:i|we|someone|somebody|one of (?:us|the team|our team)|the team|our team|[a-z]+ from (?:the|our) team)${WILL}\b|\bwill\s+(?:call|ring|phone|text|email|be\s+in\s+touch|get\s+back|send|arrange|book|sort|fix|repair|have|come|meet|confirm|follow\s+up|look\s+into|make)\b|\b(?:guarantee[sd]?|promise[sd]?|make\s+sure|ensure|without\s+fail|definitely)\b`,
  "i",
);
/**
 * Saying the business will get in touch, and perhaps when: "someone will call you this afternoon", "we'll ring you
 * tomorrow", "Sam will give you a call at 4". Taken out of the text before PROMISE looks for anything else promised.
 */
const CALLBACK = new RegExp(
  String.raw`(?:\b(?:i|we|someone|somebody|one of (?:us|the team|our team)|the team|our team|[a-z]+(?: from (?:the|our) team)?))?${WILL}\s+(?:give\s+you\s+a\s+(?:call|ring)|(?:call|ring|phone|text|email|message|contact)(?:\s+you)?(?:\s+back)?|be\s+in\s+touch|get\s+(?:back|in\s+touch)(?:\s+(?:to|with))?(?:\s+you)?|follow\s+up)\b`,
  "gi",
);
/** What the patterns above might miss: future tense, a day or time, a deadline, a number. */
const MAYBE_COMMITMENT = /\b(?:will|shall|going to|gonna|can|could|would|today|tonight|tomorrow|tmrw|morning|afternoon|evening|weekend|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|asap|soon|shortly|straight away|right away|by|before|within|until|next|later|available|availability|free)\b|'ll|’ll|\d/i;
const LEGAL = /\b(?:legal(?:ly)?|lawyer|solicitor|barrister|attorney|the law|tribunal|ncat|vcat|qcat|sacat|wacat|fair trading|consumer affairs|ombudsman|court|sue|suing|lawsuit|breach(?:ed|es)?|notice to (?:vacate|remedy|leave|terminate)|evict(?:ion|ed|ing)?|terminat(?:e|ed|ion|ing)|bond (?:claim|dispute)|residential tenanc(?:y|ies)|tenancy act|(?:my|your|tenant'?s?) rights|liab(?:le|ility)|compensat(?:e|ion)|negligen(?:t|ce)|discriminat\w*)\b/i;
/** Signs, in what they wrote, that a reply is answering a complaint. */
const COMPLAINT = /\b(?:complain\w*|unacceptable|disgust\w*|appall\w*|terrible|awful|horrible|worst|useless|hopeless|incompetent|unprofessional|rude|furious|angry|livid|not happy|unhappy|disappointed|fed up|sick of|ignor(?:ed|ing)|still waiting|never (?:called|rang|returned|replied|responded|heard|got back)|(?:no one|nobody) (?:called|rang|replied|responded|got back)|refund|crooks?|scam\w*|ripped off|rip-off|report you|bad review|one star|1 star|1-star)\b/i;
/** An apology in the reply means it is answering one. */
const APOLOGY = /\b(?:sorry|apologi[sz]e\w*|apologies)\b/i;

const quoted = (m: RegExpExecArray | null) => (m ? ` (“${m[0].trim().slice(0, 40)}”)` : "");

export interface CustomerTextCheck {
  /** Why it can't go as written; the agent is told and may rewrite it, and a person's edit is refused. */
  blocked: string | null;
  /** Why only the client may approve it. */
  signoff: string | null;
  /** A person must see it before it goes, even where the workspace lets messages go alone. */
  needsPerson: boolean;
}

/** Null for a tool nobody outside the business reads. */
export async function screenCustomerText(tool: AgentTool, input: unknown, ctx: { tenant: TenantSummary; brand: BrandProfileRecord | null }): Promise<CustomerTextCheck | null> {
  if (!tool.customerText) return null;
  const text = tool.customerText(input);
  const theirs = (tool.customerContext ? await tool.customerContext(input, { tenant: ctx.tenant }) : []).join("\n");
  const issues = checkCompliance({ text, platform: null, brand: ctx.brand, tenant: ctx.tenant }).issues;
  const blocks = issues.filter((i) => BLOCKS.has(i.code)).map((i) => i.message);
  const reasons = [...(tool.signoffReasons?.(input) ?? []), ...issues.filter((i) => SIGNOFF.has(i.code)).map((i) => i.message)];
  // A call-back time is the operator's to approve; whatever else is promised, around it or instead of it, is the client's.
  const callback = CALLBACK.test(text);
  CALLBACK.lastIndex = 0;
  const promise = PROMISE.exec(text.replace(CALLBACK, " "));
  if (promise) reasons.push(`It makes a promise${quoted(promise)}.`);
  const legal = LEGAL.exec(text) ?? LEGAL.exec(theirs);
  if (legal) reasons.push(`It touches on something legal${quoted(legal)}.`);
  const complaint = COMPLAINT.exec(theirs) ?? APOLOGY.exec(text);
  if (complaint) reasons.push(`It answers a complaint${quoted(complaint)}.`);
  const signoff = [...new Set(reasons)];
  return {
    blocked: blocks.length ? blocks.join(" ") : null,
    signoff: signoff.length ? signoff.join(" ") : null,
    needsPerson: signoff.length > 0 || callback || MAYBE_COMMITMENT.test(text),
  };
}

/** The client person who signs off agent messages: named by the workspace's escalation rules, and still a member. */
export async function signoffApprover(tenant: Pick<TenantSummary, "id" | "escalationRules">): Promise<{ userId: string; email: string; name: string | null } | null> {
  const rule = tenant.escalationRules.find((r) => r.when === AGENT_SIGNOFF_RULE) ?? tenant.escalationRules.find((r) => r.when === "*");
  if (!rule?.notifyUserId) return null;
  const member = (await repository.listTenantPeople(tenant.id)).find((p) => p.via === "member" && p.userId === rule.notifyUserId);
  return member ? { userId: member.userId, email: member.email, name: member.name } : null;
}
