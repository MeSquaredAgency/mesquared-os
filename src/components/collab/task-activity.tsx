import { BellRing } from "lucide-react";
import { Avatar } from "@/components/shell/avatar";
import type { Side, TaskEventRecord, TenantSummary } from "@/lib/types";
import { formatDateTime, timeAgo } from "@/lib/utils";
import { sideTag } from "./labels";

/** The task's activity log, oldest first: who did what and when, comments set apart. */
export function TaskActivity({ events, viewer, tenant, now }: { events: TaskEventRecord[]; viewer: Side; tenant: TenantSummary; now: Date }) {
  return (
    <ol className="relative flex flex-col gap-5 before:absolute before:top-2 before:bottom-2 before:left-[13px] before:w-px before:bg-border">
      {events.map((e) => {
        const tag = sideTag(e.actorSide, viewer);
        return (
          <li key={e.id} className="relative flex gap-3">
            {e.actorSide === "SYSTEM" ? (
              <span className="relative flex size-7 shrink-0 items-center justify-center rounded-full bg-amber-soft text-amber-text ring-4 ring-card">
                <BellRing className="size-3.5" aria-hidden="true" />
              </span>
            ) : (
              <Avatar name={e.actorName} size="sm" className="relative ring-4 ring-card" />
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-1 pt-0.5">
              <p className="text-sm">
                <span className="font-medium">{e.actorName}</span>
                {tag && <span className="ml-1.5 rounded-full bg-accent px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">{tag}</span>}
                {e.kind !== "COMMENT" && <span className="text-muted-foreground"> {lowerFirst(e.body ?? "")}</span>}
              </p>
              {e.kind === "COMMENT" && <p className="rounded-lg border bg-card px-3.5 py-2.5 text-sm whitespace-pre-wrap shadow-[0_1px_2px_#1b232c0a]">{e.body}</p>}
              <time className="text-xs text-muted-foreground" dateTime={e.createdAt.toISOString()} title={formatDateTime(e.createdAt, tenant)}>
                {timeAgo(e.createdAt, now)}
              </time>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const lowerFirst = (s: string) => (s && !/^[A-Z]{2}/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
