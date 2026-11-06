import { repository } from "@/lib/data";
import type { AgentGuidanceRecord, AgentMessageRecord, AgentRunRecord, AgentRunStatus, AgentToolCallRecord, AgentToolCallStatus, ExceptionRecord, TenantSummary } from "@/lib/types";
import { humanize } from "@/lib/utils";
import { ROLE_BY_KEY } from "./roles";
import { APPROVAL_TTL_MS, changedFields } from "./runtime";
import { signoffApprover } from "./signoff";
import { TOOL_BY_NAME } from "./tools";

/**
 * What the console shows of agent work: a card for each action an agent is
 * waiting on, and a timeline for each run. Built on the server from the run
 * tables, in words a person reads; nothing here goes back to the model.
 */

export type Tone = "green" | "red" | "amber" | "secondary" | "muted" | "outline";

export function agentName(roleKey: string): string {
  return ROLE_BY_KEY[roleKey]?.name ?? humanize(roleKey);
}

type Described = { title: string; body: string | null };

/** The tool's own description of the effect, from what will run (the edit, if a person made one). */
export async function describe(call: AgentToolCallRecord, tenant: TenantSummary): Promise<Described> {
  const tool = TOOL_BY_NAME[call.name];
  const parsed = tool?.input.safeParse(call.editedInput ?? call.input);
  const preview = tool?.preview && parsed?.success ? await Promise.resolve(tool.preview(parsed.data, { tenant })).catch(() => null) : null;
  return { title: preview?.title ?? humanize(call.name).toLowerCase(), body: preview?.body ?? null };
}

const fallback = (call: AgentToolCallRecord): Described => ({ title: humanize(call.name).toLowerCase(), body: null });

export interface AgentApprovalView {
  toolCallId: string;
  runId: string;
  agentName: string;
  /** "send a text to Ana Petrova": reads after "Customer Relations wants to". */
  title: string;
  /** The exact effect, such as the message as it would go. */
  body: string | null;
  /** The agent's own reason, when the tool asks for one. */
  why: string | null;
  /** Why it needs a person, from the policy. */
  policy: string;
  /** The one field the person may change before approving, with its current text. */
  edit: { label: string; value: string } | null;
  /** Why only the client may approve it; an operator may still decline it or take it over. */
  signoff: string | null;
  /** Who at the client signs it off, when the workspace names someone. */
  signoffBy: string | null;
  expiresAt: Date;
}

export async function approvalView(call: AgentToolCallRecord, roleKey: string, tenant: TenantSummary): Promise<AgentApprovalView> {
  const { title, body } = await describe(call, tenant);
  const approver = call.signoff ? await signoffApprover(tenant) : null;
  const editable = TOOL_BY_NAME[call.name]?.editable;
  const why = call.input.reason;
  return {
    toolCallId: call.id,
    runId: call.runId,
    agentName: agentName(roleKey),
    title,
    body,
    why: typeof why === "string" && why.trim() ? why.trim() : null,
    policy: call.reason,
    // What would run now, so a person's earlier edit is what the next person sees and starts from.
    edit: editable ? { label: editable.label, value: String((call.editedInput ?? call.input)[editable.field] ?? "") } : null,
    signoff: call.signoff,
    signoffBy: approver ? (approver.name ?? approver.email) : null,
    expiresAt: new Date(call.createdAt.getTime() + APPROVAL_TTL_MS),
  };
}

/** Exception id → approval card, for the queue items that are agents still waiting on a decision. */
export async function loadApprovalViews(items: ExceptionRecord[], tenants: TenantSummary[]): Promise<Record<string, AgentApprovalView>> {
  const tenantById = new Map(tenants.map((t) => [t.id, t]));
  const out: Record<string, AgentApprovalView> = {};
  await Promise.all(
    items
      .filter((i) => i.agentToolCallId && i.agentRunId && tenantById.has(i.tenantId))
      .map(async (item) => {
        const [call, run] = await Promise.all([repository.findAgentToolCall(item.tenantId, item.agentToolCallId!), repository.findAgentRun(item.tenantId, item.agentRunId!)]);
        if (call?.status === "AWAITING_APPROVAL" && run) out[item.id] = await approvalView(call, run.roleKey, tenantById.get(item.tenantId)!);
      }),
  );
  return out;
}

/**
 * Agent messages waiting for this client person's own sign-off: those routed to them by name, or, when the workspace
 * names nobody, those any member who approves content may sign off.
 */
export async function loadClientSignoffs(tenant: TenantSummary, viewer: { userId: string; canApprove: boolean }): Promise<AgentApprovalView[]> {
  const open = (await repository.listExceptions([tenant.id], { limit: 500 })).filter((e) => e.agentToolCallId && e.agentRunId && (e.escalatedToUserId ? e.escalatedToUserId === viewer.userId : viewer.canApprove));
  const views = await Promise.all(
    open.map(async (item) => {
      const [call, run] = await Promise.all([repository.findAgentToolCall(tenant.id, item.agentToolCallId!), repository.findAgentRun(tenant.id, item.agentRunId!)]);
      return call?.status === "AWAITING_APPROVAL" && call.signoff && run ? approvalView(call, run.roleKey, tenant) : null;
    }),
  );
  return views.filter((v): v is AgentApprovalView => v !== null).sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
}

/** Whether this client person may sign off this call: it needs sign-off, and it is theirs to give. */
export async function maySignOff(tenant: TenantSummary, toolCallId: string, viewer: { userId: string; canApprove: boolean }): Promise<boolean> {
  const call = await repository.findAgentToolCall(tenant.id, toolCallId);
  if (!call?.signoff) return false;
  const item = (await repository.listExceptions([tenant.id], { limit: 500 })).find((e) => e.agentToolCallId === toolCallId);
  return item ? (item.escalatedToUserId ? item.escalatedToUserId === viewer.userId : viewer.canApprove) : false;
}

// ---------------------------------------------------------------------------
// The run timeline
// ---------------------------------------------------------------------------

const RUN_STATUS: Record<AgentRunStatus, { label: string; tone: Tone }> = {
  QUEUED: { label: "Queued", tone: "outline" },
  RUNNING: { label: "Working", tone: "secondary" },
  WAITING: { label: "Waiting", tone: "amber" },
  PAUSED: { label: "Paused", tone: "amber" },
  DONE: { label: "Done", tone: "green" },
  FAILED: { label: "Stopped", tone: "red" },
  CANCELLED: { label: "Cancelled", tone: "muted" },
};

export function runStatus(run: Pick<AgentRunRecord, "status">, waitingOnPerson = false): { label: string; tone: Tone } {
  return run.status === "WAITING" && waitingOnPerson ? { label: "Waiting for approval", tone: "amber" } : RUN_STATUS[run.status];
}

const ACTION_STATUS: Record<AgentToolCallStatus, { label: string; tone: Tone }> = {
  PENDING: { label: "About to run", tone: "secondary" },
  AWAITING_APPROVAL: { label: "Waiting for approval", tone: "amber" },
  APPROVED: { label: "Approved, about to run", tone: "secondary" },
  DONE: { label: "Done", tone: "green" },
  ERROR: { label: "Failed", tone: "red" },
  PROPOSED: { label: "Proposed only", tone: "outline" },
  REFUSED: { label: "Refused", tone: "red" },
  REJECTED: { label: "Declined", tone: "red" },
  EXPIRED: { label: "Expired", tone: "muted" },
};

export interface ActionView {
  /** The tool call's id; null for a call the model made that was never recorded. */
  id: string | null;
  /** "Send a text to Ana Petrova". */
  title: string;
  body: string | null;
  label: string;
  tone: Tone;
  /** Waiting on a person's decision in the queue. */
  waiting: boolean;
  /** The policy's reason for its decision. */
  reason: string;
  input: string;
  /** What a person changed before it ran. */
  edited: string | null;
  /** What the agent was told came of it. */
  result: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
}

export type TimelineEntry =
  | { kind: "task"; at: Date; text: string }
  | { kind: "thinking"; at: Date; text: string | null }
  | { kind: "said"; at: Date; text: string }
  | { kind: "action"; at: Date; action: ActionView }
  | { kind: "guidance"; at: Date; text: string; by: string; read: boolean };

const CLIP = 2000;

function clip(text: string): string {
  return text.length > CLIP ? `${text.slice(0, CLIP)}…` : text;
}

function pretty(value: unknown): string {
  return clip(typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2));
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function actionView(call: AgentToolCallRecord | undefined, use: Record<string, unknown>, who: (id: string | null) => string | null, described: Map<string, Described>): ActionView {
  if (!call) {
    return { id: null, title: capitalise(humanize(String(use.name ?? "tool")).toLowerCase()), body: null, label: "Not recorded", tone: "red", waiting: false, reason: "The call was not recorded, so it was not carried out.", input: pretty(use.input), edited: null, result: null, decidedBy: null, decidedAt: null };
  }
  const { title, body } = described.get(call.id) ?? fallback(call);
  const status = ACTION_STATUS[call.status];
  return {
    id: call.id,
    title: capitalise(title),
    body,
    label: status.label,
    tone: status.tone,
    waiting: call.status === "AWAITING_APPROVAL",
    reason: call.reason,
    input: pretty(call.input),
    edited: call.editedInput ? pretty(changedFields(call.input, call.editedInput)) : null,
    result: call.result === null || call.result === undefined ? null : pretty(call.result),
    decidedBy: who(call.decidedById),
    decidedAt: call.decidedAt,
  };
}

/**
 * The run as a person reads it: the task, then each turn's thinking, words and actions in order, with guidance
 * where the agent received it. Tool results are not repeated: each action shows its own.
 */
export function buildTimeline(messages: AgentMessageRecord[], calls: AgentToolCallRecord[], guidance: AgentGuidanceRecord[], names: Record<string, string>, described: Map<string, Described> = new Map()): TimelineEntry[] {
  const who = (id: string | null) => (id ? (names[id] ?? "a person") : null);
  const byUseId = new Map(calls.map((c) => [c.toolUseId, c]));
  const note = (g: AgentGuidanceRecord): TimelineEntry => ({ kind: "guidance", at: g.createdAt, text: g.text, by: who(g.createdById) ?? "a person", read: g.deliveredSeq !== null });
  const out: TimelineEntry[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      if (m.seq === 0) {
        const text = m.content.filter((b) => b.type === "text").map((b) => String(b.text ?? "")).join("\n\n").trim();
        out.push({ kind: "task", at: m.createdAt, text });
      }
      for (const g of guidance) if (g.deliveredSeq === m.seq) out.push(note(g));
      continue;
    }
    for (const block of m.content) {
      if (block.type === "thinking") {
        const text = String(block.thinking ?? "").trim();
        if (text) out.push({ kind: "thinking", at: m.createdAt, text });
      } else if (block.type === "redacted_thinking") {
        out.push({ kind: "thinking", at: m.createdAt, text: null });
      } else if (block.type === "text") {
        const text = String(block.text ?? "").trim();
        if (text) out.push({ kind: "said", at: m.createdAt, text });
      } else if (block.type === "tool_use") {
        out.push({ kind: "action", at: m.createdAt, action: actionView(byUseId.get(String(block.id)), block, who, described) });
      }
    }
  }
  for (const g of guidance) if (g.deliveredSeq === null) out.push(note(g));
  return out;
}

export interface RunPage {
  run: AgentRunRecord;
  agentName: string;
  status: { label: string; tone: Tone };
  waitingOnPerson: boolean;
  timeline: TimelineEntry[];
}

/** Everything the run page shows, or null when the run is not in this workspace. */
export async function loadRunPage(tenant: TenantSummary, runId: string): Promise<RunPage | null> {
  const tenantId = tenant.id;
  const run = await repository.findAgentRun(tenantId, runId);
  if (!run) return null;
  const [messages, calls, guidance, operators, members] = await Promise.all([repository.listAgentMessages(tenantId, runId), repository.listAgentToolCalls(tenantId, runId), repository.listAgentGuidance(tenantId, runId), repository.listOperators(), repository.listTenantPeople(tenantId)]);
  const names: Record<string, string> = {};
  for (const p of operators) names[p.id] = p.name ?? p.email;
  for (const p of members) names[p.userId] ??= p.name ?? p.email;
  const described = new Map(await Promise.all(calls.map(async (c) => [c.id, await describe(c, tenant)] as const)));
  const waitingOnPerson = calls.some((c) => c.status === "AWAITING_APPROVAL");
  return { run, agentName: agentName(run.roleKey), status: runStatus(run, waitingOnPerson), waitingOnPerson, timeline: buildTimeline(messages, calls, guidance, names, described) };
}
