import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Empty, PageHeader } from "@/components/shell/section";
import { getPortalContext } from "@/lib/auth/access";
import { repository } from "@/lib/data";
import { describeListing } from "@/lib/inventory";
import { formatDateTime, humanize } from "@/lib/utils";

export const metadata = { title: "Inventory" };

/** The client's view of what is on the books, when the inventory module is on. */
export default async function InventoryPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { access } = await getPortalContext(slug);
  const tenant = access.tenant;
  const config = await repository.getTenantConfig(tenant.id);
  if (!config.modules.some((m) => m.moduleKey === "inventory" && m.enabled)) notFound();
  const items = await repository.listInventory(tenant.id, { limit: 300 });
  const fmt = { timezone: tenant.timezone, locale: tenant.locale };
  const active = items.filter((i) => i.status === "ACTIVE");
  const label = tenant.industry === "REAL_ESTATE" ? "Listings" : "Inventory";

  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow={label} title={`${active.length} active of ${items.length} on the books`} lede="Imported by Me² from your feed or spreadsheet. New listings are drafted into posts, and enquiries that name one get its details in the reply." />
      {items.length === 0 ? (
        <Empty>Nothing imported yet.</Empty>
      ) : (
        <ul className="surface divide-y px-5">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-4 py-3.5">
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="truncate text-sm font-medium">{i.name}</p>
                <p className="text-xs text-muted-foreground">
                  {describeListing(i, tenant.locale, tenant.currency).replace(`${i.name} · `, "") || humanize(i.type)} · updated {formatDateTime(i.updatedAt, fmt).replace(/,.*$/, "")}
                  {typeof i.attributes.url === "string" && (
                    <>
                      {" · "}
                      <a className="underline underline-offset-4" href={i.attributes.url} target="_blank" rel="noreferrer">
                        View
                      </a>
                    </>
                  )}
                </p>
              </div>
              <Badge variant={i.status === "ACTIVE" ? "green" : i.status === "LOW" ? "amber" : "muted"}>{humanize(i.status)}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
