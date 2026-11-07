import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Avatar } from "@/components/shell/avatar";
import { dueState, formatDue, STATUS_LABEL, type DueState } from "@/lib/tasks";
import type { Side, TaskRecord, TenantSummary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ownerLabel } from "./labels";

const DUE_TONE: Record<DueState, string> = {
  overdue: "border-red/25 bg-red-soft text-red-text",
  soon: "border-amber/25 bg-amber-soft text-amber-text",
  later: "border-border bg-card text-muted-foreground",
  none: "border-border bg-card text-muted-foreground",
  closed: "border-border bg-card text-muted-foreground",
};

const STATUS_DOT: Record<TaskRecord["status"], string> = { OPEN: "bg-border-strong", IN_PROGRESS: "bg-navy", WAITING: "bg-amber", DONE: "bg-green", CANCELLED: "bg-muted-foreground/40" };

export function DueChip({ task, tenant, now }: { task: Pick<TaskRecord, "status" | "dueAt">; tenant: Pick<TenantSummary, "timezone" | "locale">; now: Date }) {
  if (!task.dueAt) return null;
  const state = dueState(task, now);
  return (
    <span className={cn("inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums", DUE_TONE[state])}>
      {state === "overdue" ? "Overdue · " : state === "soon" ? "Due · " : ""}
      {formatDue(task.dueAt, tenant)}
    </span>
  );
}

interface Props {
  tasks: TaskRecord[];
  names: Record<string, string>;
  tenant: TenantSummary;
  base: string;
  viewer: Side;
  now: Date;
}

/** One row per task: status, title, who it waits on, who has it, and the deadline. */
export function TaskList({ tasks, names, tenant, base, viewer, now }: Props) {
  return (
    <ul className="surface rise-stagger divide-y px-5">
      {tasks.map((t) => {
        const assignee = t.assigneeId ? names[t.assigneeId] : null;
        return (
          <li key={t.id} className="list-row">
            <Link href={`${base}/tasks/${t.id}`} className="group flex items-center gap-3.5 py-3.5">
              <span className={cn("size-2.5 shrink-0 rounded-[3px]", STATUS_DOT[t.status])} title={STATUS_LABEL[t.status]} aria-hidden="true" />
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className={cn("truncate text-sm font-semibold tracking-[-0.01em]", (t.status === "DONE" || t.status === "CANCELLED") && "text-muted-foreground line-through decoration-1")}>{t.title}</span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span>{STATUS_LABEL[t.status]}</span>
                  <span aria-hidden="true">·</span>
                  <span>Waiting on {ownerLabel(t.owner, viewer)}</span>
                  {assignee && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1.5">
                        <Avatar name={assignee} size="sm" className="size-5 text-[9px]" />
                        {assignee}
                      </span>
                    </>
                  )}
                </span>
              </span>
              <DueChip task={t} tenant={tenant} now={now} />
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
