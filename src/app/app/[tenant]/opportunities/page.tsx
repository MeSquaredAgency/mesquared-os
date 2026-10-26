import { MissedOpportunities } from "@/components/portal/missed-opportunities";
import { Empty, PageHeader, Panel, Section } from "@/components/shell/section";
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
    <div className="flex flex-col gap-12">
      <PageHeader kicker={COPY.missedOpportunities} title={open.length === 0 ? "Nothing is slipping through" : `${open.length} thing${open.length === 1 ? "" : "s"} we’re chasing`} lede="Everything we’ve spotted slipping, what we’re doing about it, and what came back." />
      <MissedOpportunities missed={{ open, atRiskCents: open.reduce((s, m) => s + m.estimatedValueCents, 0), recoveredCents }} fmt={fmt} limit={50} />
      <Section id="closed-title" title={`${COPY.recovered} and closed`} lede="Won back, or written off after we tried.">
        {closed.length === 0 ? (
          <Empty>Nothing closed yet.</Empty>
        ) : (
          <Panel>
            <ul className="divide-y">
              {closed.map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-6 py-5">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <p className="kicker text-xs">{MISSED_OPPORTUNITY_LABEL[m.type] ?? m.type}</p>
                    <p className="text-base">{m.summary}</p>
                    <p className="text-sm text-muted-foreground">{m.resolvedAt ? timeAgo(m.resolvedAt) : timeAgo(m.detectedAt)}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span className="text-lg num">{formatMoney(m.status === "RECOVERED" ? m.recoveredValueCents : m.estimatedValueCents, fmt.currency, fmt.locale)}</span>
                    <Badge variant={m.status === "RECOVERED" ? "green" : "muted"}>{m.status === "RECOVERED" ? COPY.recovered : "Closed"}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </Section>
    </div>
  );
}
