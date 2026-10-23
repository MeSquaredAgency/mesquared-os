import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AUTOMATION_BY_KEY } from "@/lib/automations/registry";
import { COPY } from "@/lib/copy";
import type { PortalHome } from "@/lib/types";
import { timeAgo } from "@/lib/utils";

/** The quiet summary of admin work done without the client, opening into the full activity log. */
export function HandledForYou({ handled, activityHref }: { handled: PortalHome["handled"]; activityHref: string }) {
  return (
    <Card aria-labelledby="handled-title" className="bg-sidebar">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle id="handled-title" className="flex items-center gap-2">
            <Sparkles className="size-4 text-muted-foreground" aria-hidden="true" />
            {COPY.handledForYou}
          </CardTitle>
          <CardDescription className="mt-1">
            {handled.countToday} thing{handled.countToday === 1 ? "" : "s"} today, {handled.countWeek} this week, without needing you.
          </CardDescription>
        </div>
        <Link href={activityHref} className="text-xs text-primary hover:underline">
          Full {COPY.activityLog.toLowerCase()}
        </Link>
      </CardHeader>
      <CardContent>
        {handled.runs.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">Nothing yet. Once intake and automations are connected, what gets done for you appears here.</p>
        ) : (
          <ul className="divide-y">
            {handled.runs.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm">{r.summary}</p>
                  <p className="text-[11px] text-muted-foreground">{AUTOMATION_BY_KEY[r.typeKey]?.name ?? r.typeKey}</p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
