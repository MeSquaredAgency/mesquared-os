"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getPortalContext } from "@/lib/auth/access";
import { displayName, sideOf } from "@/lib/collab/people";
import { repository } from "@/lib/data";
import { TASK_STATUSES, type TaskRecord } from "@/lib/types";
import { pushToPeople } from "@/lib/push";
import { localInputToDate } from "@/lib/utils";
import { planTaskEdit, type Actor } from "./index";

export interface TaskActionResult {
  ok: boolean;
  message: string;
  taskId?: string;
}

const fields = {
  title: z.string().trim().min(2, "Give the task a title.").max(200, "Keep the title under 200 characters."),
  details: z.string().trim().max(5000, "Keep the details under 5,000 characters.").optional().nullable(),
  owner: z.enum(["ME2", "CLIENT"]),
  assigneeId: z.string().max(100).optional().nullable(),
  /** A `datetime-local` value, read in the workspace's timezone. */
  due: z.string().max(40).optional().nullable(),
};
const NewTaskInput = z.object(fields);
const EditTaskInput = z.object({ ...fields, title: fields.title.optional(), owner: fields.owner.optional(), status: z.enum(TASK_STATUSES as [string, ...string[]]).optional() }).partial();

function refresh(slug: string, taskId?: string) {
  revalidatePath(`/app/${slug}/tasks`);
  revalidatePath(`/console/${slug}/tasks`);
  revalidatePath(`/app/${slug}`);
  revalidatePath(`/console/${slug}`);
  if (taskId) {
    revalidatePath(`/app/${slug}/tasks/${taskId}`);
    revalidatePath(`/console/${slug}/tasks/${taskId}`);
  }
}

async function context(slug: string) {
  const { access, user } = await getPortalContext(slug);
  const people = await repository.listTenantPeople(access.tenant.id);
  const actor: Actor = { actorId: user.id, actorName: displayName(user), actorSide: sideOf(access) };
  const nameOf = (userId: string | null) => {
    const p = people.find((x) => x.userId === userId);
    return p ? p.name?.trim() || p.email : "someone";
  };
  return { tenant: access.tenant, user, people, actor, nameOf };
}

/** A quiet heads-up on the devices of the people a change is for; never the actor themselves. Failures never fail the action. */
async function tellPeople(userIds: (string | null | undefined)[], actorId: string, title: string, body: string, slug: string, taskId: string) {
  const to = [...new Set(userIds.filter((id): id is string => Boolean(id) && id !== actorId))];
  if (to.length) await pushToPeople(to, { title, body, url: `/app/${slug}/tasks/${taskId}`, tag: `task-${taskId}` }).catch(() => {});
}

const firstIssue = (error: z.ZodError) => error.issues[0]?.message ?? "Check the form and try again.";

export async function createTaskAction(slug: string, raw: z.input<typeof NewTaskInput>): Promise<TaskActionResult> {
  try {
    const parsed = NewTaskInput.safeParse(raw);
    if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) };
    const { tenant, user, people, actor, nameOf } = await context(slug);
    const d = parsed.data;
    if (d.assigneeId && !people.some((p) => p.userId === d.assigneeId)) return { ok: false, message: "That person isn't in this workspace." };
    const dueAt = d.due ? localInputToDate(d.due, tenant.timezone) : null;
    if (d.due && !dueAt) return { ok: false, message: "That deadline isn't a date and time." };
    const task = await repository.createTask(tenant.id, { title: d.title, details: d.details || null, owner: d.owner, assigneeId: d.assigneeId || null, dueAt, createdById: user.id }, { ...actor, body: `Created it, waiting on ${d.owner === "ME2" ? "Me²" : "the client"}${d.assigneeId ? `, for ${nameOf(d.assigneeId)}` : ""}` });
    refresh(slug, task.id);
    await tellPeople([task.assigneeId], user.id, `New task for you: ${task.title}`, `${actor.actorName} · ${tenant.name}`, slug, task.id);
    return { ok: true, message: "Task added.", taskId: task.id };
  } catch (error) {
    console.error("[tasks] create failed", error instanceof Error ? error.message : error);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

export async function updateTaskAction(slug: string, taskId: string, raw: z.input<typeof EditTaskInput>): Promise<TaskActionResult> {
  try {
    const parsed = EditTaskInput.safeParse(raw);
    if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) };
    const { tenant, people, actor, nameOf } = await context(slug);
    const task = await repository.getTask(tenant.id, taskId);
    if (!task) return { ok: false, message: "That task no longer exists." };
    const d = parsed.data;
    if (d.assigneeId && !people.some((p) => p.userId === d.assigneeId)) return { ok: false, message: "That person isn't in this workspace." };
    let dueAt: Date | null | undefined;
    if (d.due !== undefined) {
      dueAt = d.due ? localInputToDate(d.due, tenant.timezone) : null;
      if (d.due && !dueAt) return { ok: false, message: "That deadline isn't a date and time." };
    }
    const { patch, events } = planTaskEdit(task, { title: d.title, details: d.details, status: d.status as TaskRecord["status"] | undefined, owner: d.owner, assigneeId: d.assigneeId, dueAt }, actor, nameOf, tenant);
    if (events.length === 0) return { ok: true, message: "Nothing changed.", taskId };
    const updated = await repository.updateTask(tenant.id, taskId, patch, events);
    refresh(slug, taskId);
    if (patch.assigneeId) await tellPeople([patch.assigneeId], actor.actorId ?? "", `Assigned to you: ${updated.title}`, `${actor.actorName} · ${tenant.name}`, slug, taskId);
    else if (patch.status === "DONE") await tellPeople([task.createdById, task.assigneeId], actor.actorId ?? "", `Done: ${updated.title}`, `${actor.actorName} · ${tenant.name}`, slug, taskId);
    return { ok: true, message: "Saved.", taskId };
  } catch (error) {
    console.error("[tasks] update failed", error instanceof Error ? error.message : error);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

export async function commentOnTaskAction(slug: string, taskId: string, body: string): Promise<TaskActionResult> {
  try {
    const text = body.trim();
    if (!text) return { ok: false, message: "Write a comment first." };
    if (text.length > 4000) return { ok: false, message: "Keep comments under 4,000 characters." };
    const { tenant, actor } = await context(slug);
    const task = await repository.getTask(tenant.id, taskId);
    if (!task) return { ok: false, message: "That task no longer exists." };
    await repository.addTaskEvent(tenant.id, taskId, { ...actor, kind: "COMMENT", body: text });
    refresh(slug, taskId);
    await tellPeople([task.createdById, task.assigneeId], actor.actorId ?? "", `${actor.actorName} commented on ${task.title}`, tenant.name, slug, taskId);
    return { ok: true, message: "Comment added.", taskId };
  } catch (error) {
    console.error("[tasks] comment failed", error instanceof Error ? error.message : error);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}
