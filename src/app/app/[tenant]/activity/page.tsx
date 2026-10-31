import { Badge } from "@/components/ui/badge";
import { AutoRefresh } from "@/components/shell/auto-refresh";
import { Empty, PageHeader } from "@/components/shell/section";
import { getPortalContext } from "@/lib/auth/access";
import { hasPermission } from "@/lib/auth/permissions";
import { AUTOMATION_BY_KEY } from "@/lib/automations/registry";
import { COPY, outcomeLabel } from "@/lib/copy";
import { repository } from "@/lib/data";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Activity log" };

export default async function ActivityPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { access, user } = await getPortalContext(slug);
  const tenant = access.tenant;
  const onlyAssigneeId = hasPermission(access, "VIEW_ALL_RECORDS") ? null : user.id;
  const runs = await repository.listAutomationRuns(tenant.id, 200, { onlyAssigneeId });
  const fmt = { timezone: tenant.timezone, locale: tenant.locale };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow={COPY.activityLog} title={COPY.handledForYou} lede={`Everything we did without needing you, newest first. ${runs.length} entr${runs.length === 1 ? "y" : "ies"}.`} actions={<AutoRefresh />} />
      {runs.length === 0 ? (
        <Empty>Nothing yet. Once intake and automations are connected, what gets done for you appears here.</Empty>
      ) : (
        <ul className="surface divide-y px-5">
          {runs.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-4 py-3.5">
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="text-sm">{r.summary}</p>
                <p className="text-xs text-muted-foreground">
                  {AUTOMATION_BY_KEY[r.typeKey]?.name ?? r.typeKey} · {formatDateTime(r.createdAt, fmt)}
                </p>
              </div>
              <Badge variant={r.outcome === "FAILED" ? "red" : r.outcome === "ESCALATED" ? "amber" : r.outcome === "SKIPPED" ? "outline" : "muted"}>{outcomeLabel(r.outcome)}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
