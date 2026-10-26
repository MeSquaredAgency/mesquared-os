import Link from "next/link";
import { Avatar } from "@/components/shell/me2-person";
import { Section } from "@/components/shell/section";
import { Button } from "@/components/ui/button";
import { AUTOMATION_BY_KEY } from "@/lib/automations/registry";
import { COPY } from "@/lib/copy";
import type { PortalHome } from "@/lib/types";
import { timeAgo } from "@/lib/utils";

/**
 * What got done without the client, told the way the brand talks: as notes
 * from your Me² person in a chat window, not as a system log. The full
 * activity log is one click away.
 */
export function HandledForYou({ handled, activityHref }: { handled: PortalHome["handled"]; activityHref: string }) {
  const runs = handled.runs.slice(0, 6);
  return (
    <Section
      id="handled-title"
      title={COPY.handledForYou}
      lede={`${handled.countToday} thing${handled.countToday === 1 ? "" : "s"} today, ${handled.countWeek} this week, without needing you.`}
      action={
        <Button asChild variant="outline" size="sm">
          <Link href={activityHref}>Full {COPY.activityLog.toLowerCase()}</Link>
        </Button>
      }
    >
      <div className="max-w-2xl rounded-[30px] bg-card p-5 shadow-[var(--shadow-card)]">
        <div className="mb-3 flex items-center gap-3">
          <Avatar name={null} />
          <div className="leading-tight">
            <p className="text-sm font-semibold">Your Me² person</p>
            <p className="text-xs text-muted-foreground">People, backed by AI</p>
          </div>
        </div>
        {runs.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">Nothing yet. Once intake and automations are connected, what gets done for you appears here.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-col items-start gap-1">
                <p className="max-w-[86%] rounded-[19px] rounded-bl-[6px] bg-secondary px-4 py-2.5 text-sm leading-snug">{r.summary}</p>
                <p className="text-xs text-muted-foreground">
                  {AUTOMATION_BY_KEY[r.typeKey]?.name ?? r.typeKey} · {timeAgo(r.createdAt)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Section>
  );
}
