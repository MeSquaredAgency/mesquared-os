import Link from "next/link";
import { Empty, Section } from "@/components/shell/section";
import { Button } from "@/components/ui/button";
import { COPY } from "@/lib/copy";
import type { PortalHome } from "@/lib/types";
import { timeAgo } from "@/lib/utils";

/**
 * What got done without the client, as a short timeline in plain sentences:
 * notes from your Me² person, not a system log. The full activity log is one
 * click away.
 */
export function HandledForYou({ handled, activityHref }: { handled: PortalHome["handled"]; activityHref: string }) {
  const runs = handled.runs.slice(0, 6);
  return (
    <Section
      id="handled-title"
      title={COPY.handledForYou}
      lede={handled.countWeek === 0 ? "What we do without you, with a person checking the work." : `${handled.countToday} today, ${handled.countWeek} this week, with a person checking the work.`}
      action={
        <Button asChild variant="ghost" size="sm">
          <Link href={activityHref}>Full {COPY.activityLog.toLowerCase()}</Link>
        </Button>
      }
    >
      {runs.length === 0 ? (
        <Empty>Nothing yet. As enquiries start coming in, what gets done for you appears here.</Empty>
      ) : (
        <ol className="surface relative px-5 py-2 before:absolute before:top-6 before:bottom-6 before:left-[27px] before:w-px before:bg-border">
          {runs.map((r) => (
            <li key={r.id} className="relative flex items-start gap-4 py-3">
              <span aria-hidden="true" className="relative mt-[7px] block size-[7px] shrink-0 bg-brand ring-4 ring-card" />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="text-sm">{r.summary}</p>
                <p className="text-xs text-muted-foreground">{timeAgo(r.createdAt)}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
