import { CalendarCheck, Clock, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { TicketBoard as TicketBoardData } from "@/lib/data";
import { leadDisplayName } from "@/lib/leads";
import type { LeadRecord, TaskRecord, TicketType } from "@/lib/types";
import { cn, formatTime, humanize, timeAgo, type FormatContext } from "@/lib/utils";
import { StatusBadge } from "./status-badge";

type Fmt = Pick<FormatContext, "timezone" | "locale">;

const TASK_LIMIT = 8;
const LEAD_LIMIT = 6;

function TaskRow({ task, fmt }: { task: TaskRecord; fmt: Fmt }) {
  const done = task.status === "DONE" || task.status === "CANCELLED";
  return (
    <li className={cn("flex items-start justify-between gap-3 py-2.5", done && "opacity-60")}>
      <div className="flex min-w-0 flex-col gap-1">
        <span className={cn("truncate text-sm", done && "line-through")}>{task.title}</span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>{humanize(task.status)}</span>
          {task.automationKey && (
            <>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1" title="Handled by automation">
                <Sparkles className="size-3" aria-hidden="true" /> {task.automationKey}
              </span>
            </>
          )}
          {task.dueAt && !done && (
            <>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" aria-hidden="true" /> due {formatTime(task.dueAt, fmt)}
              </span>
            </>
          )}
        </span>
      </div>
      <StatusBadge status={task.priority} />
    </li>
  );
}

function LeadRow({ lead }: { lead: LeadRecord }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{leadDisplayName(lead)}</span>
        <span className="line-clamp-1 text-xs text-muted-foreground">{lead.message ?? humanize(lead.source)}</span>
        <span className="text-[11px] text-muted-foreground">
          {humanize(lead.status)} · {timeAgo(lead.createdAt)}
        </span>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-sm font-semibold tabular-nums" title="Intent score out of 100">
          {lead.intentScore ?? "–"}
        </span>
        {lead.status === "BOOKING_SENT" && (
          <span className="inline-flex items-center gap-1 text-[11px] text-green-text">
            <CalendarCheck className="size-3" aria-hidden="true" /> link sent
          </span>
        )}
      </div>
    </li>
  );
}

function More({ total, shown }: { total: number; shown: number }) {
  if (total <= shown) return null;
  return <p className="pt-2 text-xs text-muted-foreground">+{total - shown} more</p>;
}

function Column({ type, tasks, leads, fmt }: { type: TicketType; tasks: TaskRecord[]; leads: LeadRecord[]; fmt: Fmt }) {
  const green = type === "GREEN";
  const open = tasks.filter((t) => t.status !== "DONE" && t.status !== "CANCELLED");
  return (
    <Card className={cn("border-t-4", green ? "border-t-green" : "border-t-red")} aria-labelledby={`${type}-title`}>
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle id={`${type}-title`} className="flex items-center gap-2">
            <span className={cn("size-2.5 rounded-full", green ? "bg-green" : "bg-red")} aria-hidden="true" />
            {green ? "Green tickets" : "Red tickets"}
          </CardTitle>
          <CardDescription className="mt-1">
            {green ? "Revenue drivers — stock, high-intent leads, closing." : "Operational admin — automated or deferred."}
          </CardDescription>
        </div>
        <Badge variant={green ? "green" : "red"}>{open.length} open</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <section aria-label={`${green ? "Green" : "Red"} tasks`}>
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Tasks</h3>
          {tasks.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">Nothing here yet.</p>
          ) : (
            <>
              <ul className="divide-y">{tasks.slice(0, TASK_LIMIT).map((t) => <TaskRow key={t.id} task={t} fmt={fmt} />)}</ul>
              <More total={tasks.length} shown={TASK_LIMIT} />
            </>
          )}
        </section>
        <section aria-label={green ? "Qualified leads" : "Leads routed to the admin queue"}>
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {green ? "Qualified leads" : "Routed to the admin queue"}
          </h3>
          {leads.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No leads classified {green ? "green" : "red"} yet.</p>
          ) : (
            <>
              <ul className="divide-y">{leads.slice(0, LEAD_LIMIT).map((l) => <LeadRow key={l.id} lead={l} />)}</ul>
              <More total={leads.length} shown={LEAD_LIMIT} />
            </>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

export function TicketBoard({ board, fmt }: { board: TicketBoardData; fmt: Fmt }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Column type="GREEN" tasks={board.greenTasks} leads={board.greenLeads} fmt={fmt} />
      <Column type="RED" tasks={board.redTasks} leads={board.redLeads} fmt={fmt} />
    </div>
  );
}
