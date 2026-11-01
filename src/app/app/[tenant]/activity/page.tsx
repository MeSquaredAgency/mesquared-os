import { Badge } from "@/components/ui/badge";
import { AutoRefresh } from "@/components/shell/auto-refresh";
import { FilterChips, type FilterChip } from "@/components/shell/filter-chips";
import { Empty, PageHeader } from "@/components/shell/section";
import { getPortalContext } from "@/lib/auth/access";
import { hasPermission } from "@/lib/auth/permissions";
import { AUTOMATION_BY_KEY } from "@/lib/automations/registry";
import { localKey } from "@/lib/content/calendar";
import { COPY, outcomeLabel } from "@/lib/copy";
import { repository } from "@/lib/data";
import type { AutomationOutcome, AutomationRunRecord } from "@/lib/types";
import { formatTime } from "@/lib/utils";

export const metadata = { title: "Activity log" };

const OUTCOMES: AutomationOutcome[] = ["SENT", "COMPLETED", "SKIPPED", "ESCALATED", "FAILED"];
const OUTCOME_VARIANT: Record<AutomationOutcome, "red" | "amber" | "outline" | "muted"> = { FAILED: "red", ESCALATED: "amber", SKIPPED: "outline", SENT: "muted", COMPLETED: "muted" };

/** "Today", "Yesterday", or "Monday 27 October", on the tenant's calendar. */
function dayLabel(day: string, today: string, yesterday: string, locale: string, timeZone: string) {
  if (day === today) return "Today";
  if (day === yesterday) return "Yesterday";
  return new Intl.DateTimeFormat(locale, { timeZone, weekday: "long", day: "numeric", month: "long" }).format(new Date(`${day}T12:00:00Z`));
}

export default async function ActivityPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ outcome?: string }> }) {
  const { tenant: slug } = await params;
  const { outcome: rawOutcome } = await searchParams;
  const { access, user } = await getPortalContext(slug);
  const tenant = access.tenant;
  const onlyAssigneeId = hasPermission(access, "VIEW_ALL_RECORDS") ? null : user.id;
  const all = await repository.listAutomationRuns(tenant.id, 300, { onlyAssigneeId });
  const outcome = (OUTCOMES as string[]).includes(rawOutcome ?? "") ? (rawOutcome as AutomationOutcome) : null;
  const runs = outcome ? all.filter((r) => r.outcome === outcome) : all;
  const fmt = { timezone: tenant.timezone, locale: tenant.locale };

  const chips: FilterChip[] = [
    { label: "Everything", count: all.length },
    ...OUTCOMES.filter((o) => all.some((r) => r.outcome === o)).map((o) => ({ value: o, label: outcomeLabel(o), count: all.filter((r) => r.outcome === o).length, urgent: o === "FAILED" || o === "ESCALATED" })),
  ];

  // Grouped by the tenant's calendar day, newest day first, newest entry first within a day.
  const now = new Date();
  const today = localKey(tenant.timezone, now);
  const yesterday = localKey(tenant.timezone, new Date(now.getTime() - 86_400_000));
  const days = new Map<string, AutomationRunRecord[]>();
  for (const r of runs) {
    const day = localKey(tenant.timezone, r.createdAt);
    days.set(day, [...(days.get(day) ?? []), r]);
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow={COPY.activityLog} title={COPY.handledForYou} lede={`Everything we did without needing you, newest first. ${runs.length} entr${runs.length === 1 ? "y" : "ies"}${outcome ? ` marked “${outcomeLabel(outcome)}”` : ""}.`} actions={<AutoRefresh />}>
        {all.length > 0 && chips.length > 2 && <FilterChips param="outcome" label="Outcome" chips={chips} />}
      </PageHeader>
      {runs.length === 0 ? (
        <Empty>{all.length === 0 ? "Nothing yet. Once intake and automations are connected, what gets done for you appears here." : "Nothing with that outcome in the last entries."}</Empty>
      ) : (
        <div className="flex flex-col gap-6">
          {[...days.entries()].map(([day, entries]) => (
            <section key={day} aria-labelledby={`day-${day}`} className="flex flex-col gap-2">
              <h2 id={`day-${day}`} className="eyebrow">
                {dayLabel(day, today, yesterday, tenant.locale, tenant.timezone)}
                <span className="font-normal text-subtle-foreground">· {entries.length}</span>
              </h2>
              <ul className="surface divide-y px-5">
                {entries.map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-4 py-3.5">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <p className="text-sm">{r.summary}</p>
                      <p className="text-xs text-muted-foreground">
                        {AUTOMATION_BY_KEY[r.typeKey]?.name ?? r.typeKey} · {formatTime(r.createdAt, fmt)}
                      </p>
                    </div>
                    <Badge variant={OUTCOME_VARIANT[r.outcome] ?? "muted"}>{outcomeLabel(r.outcome)}</Badge>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
