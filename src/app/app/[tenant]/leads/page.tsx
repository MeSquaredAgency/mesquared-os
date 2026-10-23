import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shell/status-badge";
import { getPortalContext } from "@/lib/auth/access";
import { hasPermission } from "@/lib/auth/permissions";
import { ticketLabel } from "@/lib/copy";
import { repository } from "@/lib/data";
import { classifierLabel, leadDisplayName } from "@/lib/leads";
import { formatDateTime, humanize } from "@/lib/utils";

export const metadata = { title: "Leads" };

export default async function LeadsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { user, access } = await getPortalContext(slug);
  const tenant = access.tenant;
  const viewAll = hasPermission(access, "VIEW_ALL_RECORDS");
  const config = await repository.getTenantConfig(tenant.id);
  const stageName = new Map(config.pipelines.flatMap((p) => p.stages.map((s) => [s.id, `${p.name} · ${s.name}`])));
  const leads = (await repository.listRecentLeads(tenant.id, 100)).filter((l) => viewAll || l.assigneeId === user.id || l.assigneeId === null);
  const fmt = { timezone: tenant.timezone, locale: tenant.locale };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Leads</h1>
        <p className="text-sm text-muted-foreground">{viewAll ? "Everyone who has enquired." : "Your leads and any not yet assigned."}</p>
      </div>
      <Card>
        <CardContent>
          {leads.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No leads yet.</p>
          ) : (
            <ul className="divide-y">
              {leads.map((l) => (
                <li key={l.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {leadDisplayName(l)}
                      <Badge variant={l.ticketType === "GREEN" ? "green" : "muted"}>{ticketLabel(l.ticketType)}</Badge>
                    </p>
                    <p className="line-clamp-2 text-sm text-muted-foreground">{l.message ?? "No message"}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {humanize(l.source)} · {formatDateTime(l.createdAt, fmt)} · {classifierLabel(l.qualifiedBy)}
                      {l.stageId && stageName.has(l.stageId) && <> · {stageName.get(l.stageId)}</>}
                    </p>
                    {l.qualificationReason && (
                      <details className="text-xs text-muted-foreground">
                        <summary className="cursor-pointer">Why it was classified this way</summary>
                        <p className="mt-1">{l.qualificationReason}</p>
                      </details>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-sm font-semibold tabular-nums" title="Intent score out of 100">
                      {l.intentScore ?? "–"}
                    </span>
                    <StatusBadge status={l.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
