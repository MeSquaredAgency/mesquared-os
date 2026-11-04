import { notFound } from "next/navigation";
import { MissedOpportunities, OpportunityRow } from "@/components/portal/missed-opportunities";
import { FilterChips, type FilterChip } from "@/components/shell/filter-chips";
import { Empty, PageHeader, Section } from "@/components/shell/section";
import { getPortalContext } from "@/lib/auth/access";
import { hasPermission } from "@/lib/auth/permissions";
import { COPY, MISSED_OPPORTUNITY_LABEL } from "@/lib/copy";
import { repository } from "@/lib/data";
import { moduleOn } from "@/lib/modules/registry";
import type { MissedOpportunityType } from "@/lib/types";

export const metadata = { title: "Missed opportunities" };

const OPEN = new Set(["DETECTED", "RECOVERING", "ESCALATED"]);

export default async function OpportunitiesPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ type?: string }> }) {
  const { tenant: slug } = await params;
  const { type: rawType } = await searchParams;
  const { access, user } = await getPortalContext(slug);
  const tenant = access.tenant;
  const fmt = { timezone: tenant.timezone, locale: tenant.locale, currency: tenant.currency };
  const onlyAssigneeId = hasPermission(access, "VIEW_ALL_RECORDS") ? null : user.id;
  const config = await repository.getTenantConfig(tenant.id);
  if (!moduleOn(config.modules, "opportunities")) notFound();
  const all = await repository.listMissedOpportunities(tenant.id, { limit: 200, onlyAssigneeId });
  const type = rawType && rawType in MISSED_OPPORTUNITY_LABEL ? (rawType as MissedOpportunityType) : null;

  // Chips list every kind we have seen for this workspace, busiest first; the headline numbers follow the filter.
  const counts = new Map<MissedOpportunityType, number>();
  for (const m of all) counts.set(m.type, (counts.get(m.type) ?? 0) + 1);
  const chips: FilterChip[] = [
    { label: "All kinds", count: all.length },
    ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ value: t, label: MISSED_OPPORTUNITY_LABEL[t] ?? t, count: n })),
  ];

  const shown = type ? all.filter((m) => m.type === type) : all;
  const open = shown.filter((m) => OPEN.has(m.status));
  const closed = shown.filter((m) => !OPEN.has(m.status));
  const recoveredCents = closed.filter((m) => m.status === "RECOVERED").reduce((s, m) => s + m.recoveredValueCents, 0);
  const kind = type ? (MISSED_OPPORTUNITY_LABEL[type] ?? type).toLowerCase() : null;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={COPY.missedOpportunities}
        title={open.length === 0 ? (kind ? `No ${kind} open` : "Nothing is slipping through") : `${open.length} thing${open.length === 1 ? "" : "s"} we’re chasing`}
        lede="Everything we’ve spotted slipping, what we’re doing about it, and what came back."
      >
        {counts.size > 1 && <FilterChips param="type" label="Kind" chips={chips} />}
      </PageHeader>
      <MissedOpportunities missed={{ open, atRiskCents: open.reduce((s, m) => s + m.estimatedValueCents, 0), recoveredCents }} fmt={fmt} detailHref={`/app/${slug}/opportunities`} limit={50} />
      <Section id="closed-title" title={`${COPY.recovered} and closed`} lede="Won back, or written off after we tried.">
        {closed.length === 0 ? (
          <Empty>Nothing closed yet.</Empty>
        ) : (
          <ul className="surface divide-y px-5">
            {closed.map((m) => (
              <OpportunityRow key={m.id} m={m} fmt={fmt} href={`/app/${slug}/opportunities/${m.id}`} />
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
