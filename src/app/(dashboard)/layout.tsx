import { SidebarNav } from "@/components/dashboard/sidebar-nav";
import { TenantSwitcher } from "@/components/dashboard/tenant-switcher";
import { Badge } from "@/components/ui/badge";
import { dataMode } from "@/lib/data";
import { getCurrentTenant } from "@/lib/tenant/current";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { tenant, tenants } = await getCurrentTenant();

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 flex-col gap-6 border-r bg-sidebar p-4 md:flex">
        <div className="flex items-center gap-2 px-1">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">M²</span>
          <span className="text-sm font-semibold tracking-tight">MeSquared OS</span>
        </div>
        <TenantSwitcher current={tenant} tenants={tenants} />
        <SidebarNav />
        <div className="mt-auto flex flex-col gap-2 px-1 text-xs text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>Data source</span>
            <Badge variant={dataMode === "postgres" ? "muted" : "secondary"}>{dataMode === "postgres" ? "PostgreSQL" : "Demo"}</Badge>
          </div>
          <span>
            {tenant.timezone} · {tenant.currency}
          </span>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b px-4 md:hidden">
          <span className="text-sm font-semibold">MeSquared OS</span>
          <div className="ml-auto w-48">
            <TenantSwitcher current={tenant} tenants={tenants} />
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
