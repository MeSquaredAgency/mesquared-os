import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AutoRefresh } from "@/components/shell/auto-refresh";
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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">{COPY.activityLog}</h1>
        <p className="text-sm text-muted-foreground">Everything handled for you, newest first.</p>
      </div>
      <Card aria-labelledby="activity-title">
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle id="activity-title">{COPY.handledForYou}</CardTitle>
            <CardDescription className="mt-1">{runs.length} entries</CardDescription>
          </div>
          <AutoRefresh />
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            <ul className="divide-y">
              {runs.map((r) => (
                <li key={r.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm">{r.summary}</p>
                    <p className="text-xs text-muted-foreground">
                      {AUTOMATION_BY_KEY[r.typeKey]?.name ?? r.typeKey} · {formatDateTime(r.createdAt, fmt)}
                    </p>
                  </div>
                  <Badge variant={r.outcome === "FAILED" ? "red" : r.outcome === "ESCALATED" ? "secondary" : r.outcome === "SKIPPED" ? "outline" : "muted"}>{outcomeLabel(r.outcome)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
