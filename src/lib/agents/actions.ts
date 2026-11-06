"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getConsoleContext, getPortalContext } from "@/lib/auth/access";
import { hasPermission } from "@/lib/auth/permissions";
import { repository } from "@/lib/data";
import { AUTONOMY_LEVELS } from "./policy";
import { ROLE_BY_KEY } from "./roles";
import type { ActionResult } from "@/lib/console/actions";
import { addAgentGuidance, cancelAgentRun, decideAgentAction, pauseAgentRun, resumeAgentRun, takeOverAgentRun } from "./runtime";
import { maySignOff } from "./views";

/**
 * What an operator does about agent work from the queue and a run's page. Each checks the workspace is theirs.
 * The run controls refresh their page themselves once the action returns, rather than have the action re-render it.
 */

const id = z.string().min(1).max(100);

async function workspace(tenantId: string) {
  const { tenants, user } = await getConsoleContext();
  const access = tenants.find((t) => t.tenant.id === tenantId);
  return access ? { tenant: access.tenant, user } : null;
}

const NOT_YOURS: ActionResult = { ok: false, message: "That workspace isn’t in your portfolio." };

const decisionSchema = z.object({
  action: z.enum(["approve", "decline", "take_over"]),
  note: z.string().trim().max(500).optional(),
  /** The new text for the tool's editable field, when approving an edit. */
  edit: z.string().max(5000).optional(),
});

/** Approve (as asked or edited), decline with a note the agent reads, or take the work over and stop the run. */
export async function decideAgentApproval(tenantId: string, toolCallId: string, input: z.input<typeof decisionSchema>): Promise<ActionResult> {
  const checked = decisionSchema.safeParse(input);
  if (!checked.success || !id.safeParse(toolCallId).success) return { ok: false, message: "That decision couldn’t be read. Try again." };
  const ctx = await workspace(tenantId);
  if (!ctx) return NOT_YOURS;
  const { action, note, edit } = checked.data;
  if (action === "take_over") {
    const taken = await takeOverAgentRun(ctx.tenant, toolCallId, ctx.user.id);
    if (!taken.ok) return { ok: false, message: taken.reason };
    revalidatePath("/console", "layout");
    return { ok: true, message: "It’s yours. The agent has stopped, and what it asked to do has not been done." };
  }
  const decided = await decideAgentAction(ctx.tenant, toolCallId, { approve: action === "approve", userId: ctx.user.id, note, edit });
  if (!decided.ok) return { ok: false, message: decided.reason };
  revalidatePath("/console", "layout");
  return { ok: true, message: action === "approve" ? "Approved. The agent carries on at its next step." : "Declined. The agent will read your note." };
}

const agentSchema = z.object({ enabled: z.boolean().optional(), autonomy: z.enum(["SHADOW", "SUGGEST", "SUPERVISED", "DELEGATED"]).optional() });

/** Switches one of a workspace's agents on or off, or sets how much it may do alone, never above the role's ceiling. */
export async function setWorkspaceAgent(tenantId: string, roleKey: string, patch: z.input<typeof agentSchema>): Promise<ActionResult> {
  const checked = agentSchema.safeParse(patch);
  const role = ROLE_BY_KEY[roleKey];
  if (!checked.success || !role) return { ok: false, message: "That change couldn’t be read. Try again." };
  const ctx = await workspace(tenantId);
  if (!ctx) return NOT_YOURS;
  const { enabled, autonomy } = checked.data;
  if (enabled && !role.startsOn) return { ok: false, message: `${role.name} isn’t ready yet, so it can’t be switched on.` };
  if (autonomy && AUTONOMY_LEVELS.indexOf(autonomy) > AUTONOMY_LEVELS.indexOf(role.maxAutonomy)) return { ok: false, message: `${role.name} can work at most ${role.maxAutonomy.toLowerCase()}.` };
  await repository.upsertTenantAgent(tenantId, roleKey, { ...(enabled !== undefined ? { enabled } : {}), ...(autonomy ? { autonomy } : {}) }, ctx.user.id);
  revalidatePath("/console", "layout");
  return { ok: true, message: enabled === true ? `${role.name} is on.` : enabled === false ? `${role.name} is off. Runs it had not finished are cancelled at their next step.` : `${role.name} now works ${autonomy?.toLowerCase()}.` };
}

const signoffSchema = z.object({ approve: z.boolean(), note: z.string().trim().max(500).optional(), edit: z.string().max(5000).optional() });

/**
 * The client's own sign-off on an agent message, from their portal. Only a member of the client's team may give it,
 * and only the person the workspace names for it (or, when nobody is named, someone who approves content).
 */
export async function decideAgentSignoff(tenantSlug: string, toolCallId: string, input: z.input<typeof signoffSchema>): Promise<ActionResult> {
  const checked = signoffSchema.safeParse(input);
  if (!checked.success || !id.safeParse(toolCallId).success) return { ok: false, message: "That decision couldn’t be read. Try again." };
  const { access, user } = await getPortalContext(tenantSlug);
  if (access.via !== "member") return { ok: false, message: `Only someone at ${access.tenant.name} can sign this off.` };
  if (!(await maySignOff(access.tenant, toolCallId, { userId: user.id, canApprove: hasPermission(access, "APPROVE_CONTENT") }))) return { ok: false, message: "This one isn’t yours to sign off." };
  const { approve, note, edit } = checked.data;
  const decided = await decideAgentAction(access.tenant, toolCallId, { approve, userId: user.id, asClient: true, note, edit });
  if (!decided.ok) return { ok: false, message: decided.reason };
  revalidatePath(`/app/${tenantSlug}`);
  return { ok: true, message: approve ? "Approved. It goes out in a minute or two." : "Declined. Nothing was sent." };
}

export async function pauseRun(tenantId: string, runId: string): Promise<ActionResult> {
  const ctx = await workspace(tenantId);
  if (!ctx) return NOT_YOURS;
  if (!id.safeParse(runId).success || !(await pauseAgentRun(ctx.tenant, runId))) return { ok: false, message: "That run can’t be paused now: it has finished or is already paused." };
  return { ok: true, message: "Paused. If it was mid-step, that step finishes first." };
}

export async function resumeRun(tenantId: string, runId: string): Promise<ActionResult> {
  const ctx = await workspace(tenantId);
  if (!ctx) return NOT_YOURS;
  if (!id.safeParse(runId).success || !(await resumeAgentRun(ctx.tenant, runId))) return { ok: false, message: "That run isn’t paused." };
  return { ok: true, message: "Resumed. It carries on at its next step." };
}

const noteSchema = z.string().trim().max(500);

export async function cancelRun(tenantId: string, runId: string, note: string): Promise<ActionResult> {
  const ctx = await workspace(tenantId);
  if (!ctx) return NOT_YOURS;
  const why = noteSchema.safeParse(note ?? "");
  if (!why.success) return { ok: false, message: "Keep the reason under 500 characters." };
  if (!id.safeParse(runId).success || !(await cancelAgentRun(ctx.tenant, runId, why.data ? `a person stopped it: ${why.data}` : "a person stopped it."))) return { ok: false, message: "That run has already finished." };
  return { ok: true, message: "Cancelled. Anything it was waiting on has been closed." };
}

export async function steerRun(tenantId: string, runId: string, text: string): Promise<ActionResult> {
  const ctx = await workspace(tenantId);
  if (!ctx) return NOT_YOURS;
  if (!id.safeParse(runId).success || typeof text !== "string") return { ok: false, message: "That guidance couldn’t be read. Try again." };
  const added = await addAgentGuidance(ctx.tenant, runId, text, ctx.user.id);
  if (!added.ok) return { ok: false, message: added.reason };
  return { ok: true, message: "Added. The agent reads it at its next step." };
}
