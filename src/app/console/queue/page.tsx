import { ExceptionQueue, type QueueStake } from "@/components/console/exception-queue";
import { FilterChips, type FilterChip } from "@/components/shell/filter-chips";
import { PageHeader } from "@/components/shell/section";
import { loadApprovalViews } from "@/lib/agents/views";
import { getConsoleContext } from "@/lib/auth/access";
import { MISSED_OPPORTUNITY_LABEL } from "@/lib/copy";
import { repository } from "@/lib/data";
import { toTenantOption } from "@/lib/types";

export const metadata = { title: "Queue" };

const VIEWS = ["", "agent", "client", "automation"] as const;
type View = (typeof VIEWS)[number];
const SORTS = ["", "value"] as const;
type Sort = (typeof SORTS)[number];

/**
 * The operator queue across the portfolio. Filters live in the URL
 * (`?workspace=slug&view=client&sort=value`) so a view can be shared or
 * bookmarked, and the server renders exactly what is asked for. Each item
 * carries the money at stake, so "most valuable first" is one click.
 */
export default async function QueuePage({ searchParams }: { searchParams: Promise<{ workspace?: string; view?: string; sort?: string }> }) {
  const { tenants } = await getConsoleContext();
  const { workspace, view: rawView, sort: rawSort } = await searchParams;
  const view: View = (VIEWS as readonly string[]).includes(rawView ?? "") ? (rawView as View) : "";
  const sort: Sort = (SORTS as readonly string[]).includes(rawSort ?? "") ? (rawSort as Sort) : "";
  const all = (await repository.listExceptions(tenants.map((t) => t.tenant.id), { limit: 500 })).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const bySlug = new Map(tenants.map((t) => [t.tenant.slug, t.tenant]));
  const selected = workspace && bySlug.has(workspace) ? bySlug.get(workspace)! : null;

  // What each item is worth: the open missed opportunity behind it, looked up per workspace that has items.
  const stakes: Record<string, QueueStake> = {};
  const tenantIdsWithItems = [...new Set(all.map((i) => i.tenantId))].filter((id) => all.some((i) => i.tenantId === id && i.missedOpportunityId));
  await Promise.all(
    tenantIdsWithItems.map(async (tenantId) => {
      const tenant = tenants.find((t) => t.tenant.id === tenantId)?.tenant;
      if (!tenant) return;
      for (const m of await repository.listMissedOpportunities(tenantId, { status: ["DETECTED", "RECOVERING", "ESCALATED"], limit: 500 })) {
        stakes[m.id] = { valueCents: m.estimatedValueCents, label: MISSED_OPPORTUNITY_LABEL[m.type] ?? m.type, currency: tenant.currency, locale: tenant.locale };
      }
    }),
  );

  const isAutomation = (item: (typeof all)[number]) => !item.missedOpportunityId && !item.agentToolCallId;
  const matchesView = (item: (typeof all)[number]) => (view === "agent" ? Boolean(item.agentToolCallId) : view === "client" ? Boolean(item.escalatedToUserId) : view === "automation" ? isAutomation(item) : true);
  const inWorkspace = selected ? all.filter((i) => i.tenantId === selected.id) : all;
  const filtered = inWorkspace.filter(matchesView);
  const valueOf = (item: (typeof all)[number]) => (item.missedOpportunityId ? stakes[item.missedOpportunityId]?.valueCents ?? 0 : 0);
  const items = sort === "value" ? [...filtered].sort((a, b) => valueOf(b) - valueOf(a) || a.createdAt.getTime() - b.createdAt.getTime()) : filtered;
  const atStakeCents = filtered.reduce((sum, i) => sum + valueOf(i), 0);
  const money = selected ?? tenants[0]?.tenant;
  const approvals = await loadApprovalViews(items, tenants.map((t) => t.tenant));

  const workspaceChips: FilterChip[] = [
    { label: "All workspaces", count: all.filter(matchesView).length, urgent: true },
    ...tenants
      .map((t) => ({ value: t.tenant.slug, label: t.tenant.name, count: all.filter((i) => i.tenantId === t.tenant.id && matchesView(i)).length, urgent: true }))
      .sort((a, b) => b.count - a.count),
  ];
  const viewChips: FilterChip[] = [
    { label: "Everything", count: inWorkspace.length },
    { value: "agent", label: "Agent approvals", count: inWorkspace.filter((i) => Boolean(i.agentToolCallId)).length },
    { value: "client", label: "Escalated to the client", count: inWorkspace.filter((i) => Boolean(i.escalatedToUserId)).length },
    { value: "automation", label: "Automation failures", count: inWorkspace.filter(isAutomation).length },
  ];
  const sortChips: FilterChip[] = [
    { label: "Oldest first" },
    { value: "value", label: "Most at stake first" },
  ];

  const scope = selected ? ` at ${selected.name}` : " across your portfolio";
  const title = items.length === 0 ? (all.length === 0 ? "The queue is clear" : "Nothing here") : `${items.length} thing${items.length === 1 ? "" : "s"} for a person`;
  const stake = money && atStakeCents > 0 ? ` ${new Intl.NumberFormat(money.locale, { style: "currency", currency: money.currency, maximumFractionDigits: 0 }).format(atStakeCents / 100)} is riding on them.` : "";
  const lede = all.length === 0 ? "Everything automation couldn’t finish on its own lands here. Right now, nothing." : `Everything automation couldn’t finish on its own${scope}.${stake}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Operator console" title={title} lede={lede}>
        {all.length > 0 && (
          <div className="flex flex-col gap-2">
            {tenants.length > 1 && <FilterChips param="workspace" label="Workspace" chips={workspaceChips} />}
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <FilterChips param="view" label="Kind" chips={viewChips} />
              <FilterChips param="sort" label="Order" chips={sortChips} />
            </div>
          </div>
        )}
      </PageHeader>
      <ExceptionQueue key={`${selected?.id ?? "all"}:${view}:${sort}`} items={items} tenants={tenants.map((t) => toTenantOption(t.tenant))} stakes={stakes} approvals={approvals} />
    </div>
  );
}
