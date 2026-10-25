import { MissedOpportunities } from "@/components/portal/missed-opportunities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getPortalContext } from "@/lib/auth/access";
import { hasPermission } from "@/lib/auth/permissions";
import { COPY, MISSED_OPPORTUNITY_LABEL } from "@/lib/copy";
import { repository } from "@/lib/data";
import { formatMoney, timeAgo } from "@/lib/utils";

export const metadata = { title: "Missed opportunities" };

export default async function OpportunitiesPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { access, user } = await getPortalContext(slug);
  const tenant = access.tenant;
  const fmt = { timezone: tenant.timezone, locale: tenant.locale, currency: tenant.currency };
  const onlyAssigneeId = hasPermission(access, "VIEW_ALL_RECORDS") ? null : user.id;
  const all = await repository.listMissedOpportunities(tenant.id, { limit: 200, onlyAssigneeId });
  const open = all.filter((m) => m.status === "DETECTED" || m.status === "RECOVERING" || m.status === "ESCALATED");
  const closed = all.filter((m) => m.status === "RECOVERED" || m.status === "EXPIRED");
  const recoveredCents = closed.filter((m) => m.status === "RECOVERED").reduce((s, m) => s + m.recoveredValueCents, 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{COPY.missedOpportunities}</h1>
        <p className="text-sm text-muted-foreground">Everything we’ve spotted slipping, and what came back.</p>
      </div>
      <MissedOpportunities missed={{ open, atRiskCents: open.reduce((s, m) => s + m.estimatedValueCents, 0), recoveredCents }} fmt={fmt} limit={50} />
      <Card aria-labelledby="closed-title">
        <CardHeader>
          <CardTitle id="closed-title">{COPY.recovered} and closed</CardTitle>
        </CardHeader>
        <CardContent>
          {closed.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing closed yet.</p>
          ) : (
            <ul className="divide-y">
              {closed.map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{MISSED_OPPORTUNITY_LABEL[m.type] ?? m.type}</p>
                    <p className="text-sm">{m.summary}</p>
                    <p className="text-[11px] text-muted-foreground">{m.resolvedAt ? timeAgo(m.resolvedAt) : timeAgo(m.detectedAt)}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-sm font-semibold tabular-nums">{formatMoney(m.status === "RECOVERED" ? m.recoveredValueCents : m.estimatedValueCents, fmt.currency, fmt.locale)}</span>
                    <Badge variant={m.status === "RECOVERED" ? "green" : "muted"}>{m.status === "RECOVERED" ? COPY.recovered : "Closed"}</Badge>
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
