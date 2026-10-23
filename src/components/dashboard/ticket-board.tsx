import { CalendarCheck, Clock, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { TicketBoard as TicketBoardData } from "@/lib/data";
import type { LeadRecord, TaskRecord, TicketType } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";
import { humanize } from "./platform";

const PRIORITY_VARIANT: Record<TaskRecord["priority"], "red" | "secondary" | "muted" | "outline"> = {
  URGENT: "red",
  HIGH: "secondary",
  NORMAL: "muted",
  LOW: "outline",
};

function TaskRow({ task }: { task: TaskRecord }) {
  const done = task.status === "DONE" || task.status === "CANCELLED";
  return (
    <li className={cn("flex items-start justify-between gap-3 py-2.5", done && "opacity-50")}>
      <div className="flex min-w-0 flex-col gap-1">
        <span className={cn("truncate text-sm", done && "line-through")}>{task.title}</span>
        <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>{humanize(task.status)}</span>
          {task.automationKey && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                <Sparkles className="size-3" /> {task.automationKey}
              </span>
            </>
          )}
          {task.dueAt && !done && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" /> due {task.dueAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </>
          )}
        </span>
      </div>
      <Badge variant={PRIORITY_VARIANT[task.priority]}>{humanize(task.priority)}</Badge>
    </li>
  );
}

function LeadRow({ lead }: { lead: LeadRecord }) {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.email || lead.phone || "Unknown";
  return (
    <li className="flex items-start justify-between gap-3 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{name}</span>
        <span className="line-clamp-1 text-xs text-muted-foreground">{lead.message ?? humanize(lead.source)}</span>
        <span className="text-[11px] text-muted-foreground">
          {humanize(lead.status)} · {timeAgo(lead.createdAt)}
        </span>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-sm font-semibold tabular-nums">{lead.intentScore ?? "–"}</span>
        {lead.status === "BOOKING_SENT" && (
          <span className="inline-flex items-center gap-1 text-[11px] text-green">
            <CalendarCheck className="size-3" /> link sent
          </span>
        )}
      </div>
    </li>
  );
}

function Column({
  type,
  tasks,
  leads,
}: {
  type: TicketType;
  tasks: TaskRecord[];
  leads: LeadRecord[];
}) {
  const green = type === "GREEN";
  const open = tasks.filter((t) => t.status !== "DONE" && t.status !== "CANCELLED");
  return (
    <Card className={cn("border-t-4", green ? "border-t-green" : "border-t-red")}>
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <span className={cn("size-2.5 rounded-full", green ? "bg-green" : "bg-red")} />
            {green ? "Green tickets" : "Red tickets"}
          </CardTitle>
          <CardDescription className="mt-1">
            {green ? "Revenue drivers — stock, high-intent leads, closing." : "Operational admin — automated or deferred."}
          </CardDescription>
        </div>
        <Badge variant={green ? "green" : "red"}>{open.length} open</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <section>
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Tasks</h3>
          {tasks.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">Nothing here yet.</p>
          ) : (
            <ul className="divide-y">{tasks.slice(0, 8).map((t) => <TaskRow key={t.id} task={t} />)}</ul>
          )}
        </section>
        <section>
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {green ? "Qualified leads" : "Routed to nurture"}
          </h3>
          {leads.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No leads classified {green ? "green" : "red"} yet.</p>
          ) : (
            <ul className="divide-y">{leads.slice(0, 6).map((l) => <LeadRow key={l.id} lead={l} />)}</ul>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

export function TicketBoard({ board }: { board: TicketBoardData }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Column type="GREEN" tasks={board.greenTasks} leads={board.greenLeads} />
      <Column type="RED" tasks={board.redTasks} leads={board.redLeads} />
    </div>
  );
}
