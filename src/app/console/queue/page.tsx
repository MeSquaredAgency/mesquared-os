import { ExceptionQueue } from "@/components/console/exception-queue";
import { FilterChips, type FilterChip } from "@/components/shell/filter-chips";
import { PageHeader } from "@/components/shell/section";
import { getConsoleContext } from "@/lib/auth/access";
import { repository } from "@/lib/data";
import { toTenantOption } from "@/lib/types";

export const metadata = { title: "Queue" };

const VIEWS = ["", "client", "automation"] as const;
type View = (typeof VIEWS)[number];

/**
 * The operator queue across the portfolio. Filters live in the URL
 * (`?workspace=slug&view=client`) so a view can be shared or bookmarked, and
 * the server renders exactly what is asked for.
 */
export default async function QueuePage({ searchParams }: { searchParams: Promise<{ workspace?: string; view?: string }> }) {
  const { tenants } = await getConsoleContext();
  const { workspace, view: rawView } = await searchParams;
  const view: View = (VIEWS as readonly string[]).includes(rawView ?? "") ? (rawView as View) : "";
  const all = (await repository.listExceptions(tenants.map((t) => t.tenant.id), { limit: 500 })).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const bySlug = new Map(tenants.map((t) => [t.tenant.slug, t.tenant]));
  const selected = workspace && bySlug.has(workspace) ? bySlug.get(workspace)! : null;

  const matchesView = (item: (typeof all)[number]) => (view === "client" ? Boolean(item.escalatedToUserId) : view === "automation" ? !item.missedOpportunityId : true);
  const inWorkspace = selected ? all.filter((i) => i.tenantId === selected.id) : all;
  const items = inWorkspace.filter(matchesView);

  const workspaceChips: FilterChip[] = [
    { label: "All workspaces", count: all.filter(matchesView).length, urgent: true },
    ...tenants
      .map((t) => ({ value: t.tenant.slug, label: t.tenant.name, count: all.filter((i) => i.tenantId === t.tenant.id && matchesView(i)).length, urgent: true }))
      .sort((a, b) => b.count - a.count),
  ];
  const viewChips: FilterChip[] = [
    { label: "Everything", count: inWorkspace.length },
    { value: "client", label: "Escalated to the client", count: inWorkspace.filter((i) => Boolean(i.escalatedToUserId)).length },
    { value: "automation", label: "Automation failures", count: inWorkspace.filter((i) => !i.missedOpportunityId).length },
  ];

  const scope = selected ? ` at ${selected.name}` : " across your portfolio";
  const title = items.length === 0 ? (all.length === 0 ? "The queue is clear" : "Nothing here") : `${items.length} thing${items.length === 1 ? "" : "s"} for a person`;
  const lede = all.length === 0 ? "Everything automation couldn’t finish on its own lands here. Right now, nothing." : `Everything automation couldn’t finish on its own${scope}. Oldest first.`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Operator console" title={title} lede={lede}>
        {all.length > 0 && (
          <div className="flex flex-col gap-2">
            {tenants.length > 1 && <FilterChips param="workspace" label="Workspace" chips={workspaceChips} />}
            <FilterChips param="view" label="Kind" chips={viewChips} />
          </div>
        )}
      </PageHeader>
      <ExceptionQueue key={`${selected?.id ?? "all"}:${view}`} items={items} tenants={tenants.map((t) => toTenantOption(t.tenant))} />
    </div>
  );
}
