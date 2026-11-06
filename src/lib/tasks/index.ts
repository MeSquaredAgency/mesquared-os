import { appUrl, peopleOnSide, SIDE_LABEL, type Recipient } from "@/lib/collab/people";
import { repository } from "@/lib/data";
import type { NewTaskEvent, TaskPatch } from "@/lib/data/repository";
import { errorText, log } from "@/lib/log";
import { sendMessage, templates } from "@/lib/messaging";
import { OPEN_TASK_STATUSES, type Side, type TaskRecord, type TaskStatus, type TenantSummary } from "@/lib/types";

export const STATUS_LABEL: Record<TaskStatus, string> = { OPEN: "To do", IN_PROGRESS: "In progress", WAITING: "Blocked", DONE: "Done", CANCELLED: "Cancelled" };
export const OWNER_LABEL: Record<Side, string> = { ME2: "Me²", CLIENT: "Client" };

/** How long before a deadline the first reminder goes. */
export const DUE_SOON_MS = 24 * 60 * 60_000;

export type DueState = "overdue" | "soon" | "later" | "none" | "closed";

export function isOpen(task: Pick<TaskRecord, "status">): boolean {
  return OPEN_TASK_STATUSES.includes(task.status);
}

export function dueState(task: Pick<TaskRecord, "status" | "dueAt">, now = new Date()): DueState {
  if (!isOpen(task)) return "closed";
  if (!task.dueAt) return "none";
  const left = task.dueAt.getTime() - now.getTime();
  return left < 0 ? "overdue" : left <= DUE_SOON_MS ? "soon" : "later";
}

/** "Tue 10 Nov, 5:00 pm" in the workspace's zone. */
export function formatDue(date: Date, tenant: Pick<TenantSummary, "timezone" | "locale">): string {
  return new Intl.DateTimeFormat(tenant.locale, { timeZone: tenant.timezone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(date);
}

/** A Date as a `datetime-local` value in the workspace's zone, for an edit form. */
export function toLocalInput(date: Date | null, timeZone: string): string {
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

export interface TaskEdit {
  title?: string;
  details?: string | null;
  status?: TaskStatus;
  owner?: Side;
  assigneeId?: string | null;
  dueAt?: Date | null;
}

export interface Actor {
  actorId: string | null;
  actorName: string;
  actorSide: Side | "SYSTEM";
}

/**
 * Turns an edit into the patch to store and one activity line per change.
 * Moving the deadline resets the reminders for it; closing a task stamps
 * when, and reopening clears that.
 */
export function planTaskEdit(task: TaskRecord, edit: TaskEdit, actor: Actor, names: (userId: string | null) => string, tenant: Pick<TenantSummary, "timezone" | "locale">, now = new Date()): { patch: TaskPatch; events: NewTaskEvent[] } {
  const patch: TaskPatch = {};
  const events: NewTaskEvent[] = [];
  const line = (kind: NewTaskEvent["kind"], body: string, data: Record<string, unknown>) => events.push({ ...actor, kind, body, data });

  if (edit.title !== undefined && edit.title.trim() && edit.title.trim() !== task.title) {
    patch.title = edit.title.trim();
    line("EDITED", `Renamed it to "${patch.title}"`, { from: task.title, to: patch.title });
  }
  if (edit.details !== undefined && (edit.details?.trim() || null) !== task.details) {
    patch.details = edit.details?.trim() || null;
    line("EDITED", patch.details ? "Updated the details" : "Cleared the details", {});
  }
  if (edit.status && edit.status !== task.status) {
    patch.status = edit.status;
    const closing = edit.status === "DONE" || edit.status === "CANCELLED";
    patch.completedAt = closing ? now : null;
    line("STATUS", `Moved it from ${STATUS_LABEL[task.status]} to ${STATUS_LABEL[edit.status]}`, { from: task.status, to: edit.status });
  }
  if (edit.owner && edit.owner !== task.owner) {
    patch.owner = edit.owner;
    line("OWNER", `Now waiting on ${edit.owner === "ME2" ? "Me²" : "the client"}`, { from: task.owner, to: edit.owner });
  }
  if (edit.assigneeId !== undefined && (edit.assigneeId || null) !== task.assigneeId) {
    patch.assigneeId = edit.assigneeId || null;
    line("ASSIGNED", patch.assigneeId ? `Assigned it to ${names(patch.assigneeId)}` : "Unassigned it", { from: task.assigneeId, to: patch.assigneeId });
  }
  if (edit.dueAt !== undefined && (edit.dueAt?.getTime() ?? null) !== (task.dueAt?.getTime() ?? null)) {
    patch.dueAt = edit.dueAt;
    patch.reminded = null;
    line("DUE", edit.dueAt ? `${task.dueAt ? "Moved the deadline" : "Set a deadline"} to ${formatDue(edit.dueAt, tenant)}` : "Removed the deadline", { from: task.dueAt?.toISOString() ?? null, to: edit.dueAt?.toISOString() ?? null });
  }
  return { patch, events };
}

const firstName = (name: string | null) => name?.trim().split(/\s+/)[0] ?? null;

/** "Morgan and Casey", "Morgan, Casey and 2 others". */
export function namesList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "nobody";
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} others`;
}

/**
 * Who a reminder goes to. Due soon: the assignee, or the side that owes it.
 * Overdue: the assignee and the side that owes it; when the client owes it,
 * Me² hears too, so someone can chase.
 */
export async function reminderRecipients(task: TaskRecord, stage: "DUE_SOON" | "OVERDUE"): Promise<Recipient[]> {
  const people = await repository.listTenantPeople(task.tenantId);
  const assignee = task.assigneeId ? people.find((p) => p.userId === task.assigneeId) : undefined;
  const out = new Map<string, Recipient>();
  const add = (r: Recipient) => out.set(r.userId, r);
  if (assignee) add({ userId: assignee.userId, email: assignee.email, name: assignee.name });
  if (stage === "OVERDUE" || !assignee) for (const r of await peopleOnSide(task.tenantId, task.owner, people)) add(r);
  if (stage === "OVERDUE" && task.owner === "CLIENT") for (const r of await peopleOnSide(task.tenantId, "ME2", people)) add(r);
  return [...out.values()];
}

export interface ReminderResult {
  dueSoon: number;
  overdue: number;
}

/**
 * The scheduler's pass over deadlines, every tick. Each open task gets at most
 * one "due soon" email (a day before) and one "overdue" email per deadline;
 * claiming the stage first means two overlapping ticks never both send. An
 * overdue task Me² owes also lands in the operator queue.
 */
export async function remindDueTasks(tenants: TenantSummary[], now = new Date()): Promise<ReminderResult> {
  const byId = new Map(tenants.map((t) => [t.id, t]));
  const result: ReminderResult = { dueSoon: 0, overdue: 0 };
  const overdue = await repository.listTasksForReminder(now, "OVERDUE");
  const soon = (await repository.listTasksForReminder(new Date(now.getTime() + DUE_SOON_MS), "DUE_SOON")).filter((t) => t.dueAt && t.dueAt > now);
  for (const [stage, tasks] of [["OVERDUE", overdue], ["DUE_SOON", soon]] as const) {
    for (const task of tasks) {
      const tenant = byId.get(task.tenantId);
      if (!tenant || !task.dueAt) continue;
      try {
        if (!(await repository.claimTaskReminder(tenant.id, task.id, task.reminded, stage))) continue;
        const recipients = await reminderRecipients(task, stage);
        const dueText = formatDue(task.dueAt, tenant);
        const taskUrl = appUrl(`/app/${tenant.slug}/tasks/${task.id}`);
        const waitingOn = task.owner === "ME2" ? "Me²" : `the ${tenant.name} team`;
        const reached: string[] = [];
        let notConnected = false;
        for (const r of recipients) {
          const mail = templates.taskReminderEmail({ tenant, firstName: firstName(r.name), title: task.title, stage, dueText, waitingOn, taskUrl });
          const sent = await sendMessage({ tenant, contactId: null, channel: "EMAIL", to: r.email, subject: mail.subject, body: mail.body, transactional: true });
          if (sent.ok) reached.push(r.name?.trim() || r.email);
          else if (sent.simulated) notConnected = true;
          else log("warn", "tasks.reminder_send_failed", { tenantId: tenant.id, taskId: task.id, error: sent.error });
        }
        if (stage === "OVERDUE" && task.owner === "ME2") {
          await repository.createException(tenant.id, { reason: `Task overdue: "${task.title}" was due ${dueText}.`, suggestedAction: `Finish it, move the deadline, or tell the client: ${taskUrl}` });
        }
        await repository.addTaskEvent(tenant.id, task.id, {
          kind: "REMINDER",
          actorId: null,
          actorName: "Reminder",
          actorSide: "SYSTEM",
          body: `${stage === "OVERDUE" ? "went out because it is overdue" : "went out because it is due within a day"}: ${reached.length ? `emailed ${namesList(reached)}` : notConnected ? "email isn't connected yet, so nobody was emailed" : "nobody could be emailed"}${stage === "OVERDUE" && task.owner === "ME2" ? ", and raised it in the Me² queue" : ""}`,
          data: { stage, recipients: reached.length },
        });
        result[stage === "OVERDUE" ? "overdue" : "dueSoon"]++;
      } catch (error) {
        log("error", "tasks.reminder_failed", { tenantId: tenant.id, taskId: task.id, stage, error: errorText(error) });
      }
    }
  }
  return result;
}

/** For a nav badge or a tab: open tasks this side owes that are overdue or due within a day. */
export function urgentTaskCount(tasks: TaskRecord[], side: Side, now = new Date()): number {
  return tasks.filter((t) => t.owner === side && (dueState(t, now) === "overdue" || dueState(t, now) === "soon")).length;
}

export { SIDE_LABEL };
