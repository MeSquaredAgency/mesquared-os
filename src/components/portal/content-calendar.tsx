import { Badge } from "@/components/ui/badge";
import { Section } from "@/components/shell/section";
import { StatusBadge } from "@/components/shell/status-badge";
import { PLATFORM_LABEL } from "@/components/shell/platform";
import type { CalendarDay } from "@/lib/content/calendar";
import type { FormatContext } from "@/lib/utils";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Two weeks of what is going out, by day. Server component: data is prepared by the page. */
export function ContentCalendar({ days, fmt, title = "Calendar", description = "What’s going out over the next two weeks." }: { days: CalendarDay[]; fmt: Pick<FormatContext, "timezone" | "locale">; title?: string; description?: string }) {
  const total = days.reduce((n, d) => n + d.posts.length + d.drafts.length, 0);
  return (
    <Section id="calendar-title" title={title} lede={description} action={<Badge variant={total ? "secondary" : "muted"}>{total} planned</Badge>}>
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
        {days.map((day) => {
          const [, m, d] = day.date.split("-");
          const items = [...day.posts.map((p) => ({ key: p.id, label: PLATFORM_LABEL[p.platform], text: p.caption, status: p.status, at: p.scheduledFor ?? p.publishedAt })), ...day.drafts.map((a) => ({ key: a.id, label: a.targetPlatform ? PLATFORM_LABEL[a.targetPlatform] : "Draft", text: a.title ?? "", status: a.status, at: a.scheduledFor }))];
          return (
            <li key={day.date} className={cn("min-h-28 rounded-lg border bg-card p-3", day.isToday && "border-foreground/50")}>
              <p className="mb-2 flex items-baseline justify-between text-xs text-muted-foreground">
                <span className={cn(day.isToday && "kicker text-xs")}>{day.isToday ? "Today" : WEEKDAYS[day.weekday]}</span>
                <span className="font-medium text-foreground num">
                  {Number(d)}/{Number(m)}
                </span>
              </p>
              {items.length === 0 ? (
                <p className="text-xs text-muted-foreground/60" aria-hidden="true">—</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {items.map((it) => (
                    <li key={it.key} className="rounded-lg bg-secondary p-2 text-xs">
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate font-medium">{it.label}</span>
                        <span className="shrink-0 text-muted-foreground">{it.at ? it.at.toLocaleTimeString(fmt.locale, { timeZone: fmt.timezone, hour: "numeric", minute: "2-digit" }) : ""}</span>
                      </div>
                      <p className="line-clamp-2 text-muted-foreground">{it.text}</p>
                      <StatusBadge status={it.status} className="mt-1.5" />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </Section>
  );
}
