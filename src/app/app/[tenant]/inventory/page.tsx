import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{label}</h1>
        <p className="text-sm text-muted-foreground">
          {active.length} active of {items.length}. New listings are drafted into posts automatically, and enquiries that name one get its details in the automatic reply.
        </p>
      </div>
      <Card aria-labelledby="inventory-title">
        <CardHeader>
          <CardTitle id="inventory-title">On the books</CardTitle>
          <CardDescription>Imported by Me² from your listing feed or spreadsheet.</CardDescription>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nothing imported yet.</p>
          ) : (
            <ul className="divide-y">
              {items.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{i.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {describeListing(i, tenant.locale, tenant.currency).replace(`${i.name} · `, "") || humanize(i.type)} · updated {formatDateTime(i.updatedAt, fmt).replace(/,.*$/, "")}
                      {typeof i.attributes.url === "string" && (
                        <>
                          {" · "}
                          <a className="underline" href={i.attributes.url} target="_blank" rel="noreferrer">
                            View
                          </a>
                        </>
                      )}
                    </p>
                  </div>
                  <Badge variant={i.status === "ACTIVE" ? "green" : i.status === "LOW" ? "secondary" : "muted"}>{humanize(i.status)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
