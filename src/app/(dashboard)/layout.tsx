import { MobileNav, SidebarNav } from "@/components/dashboard/sidebar-nav";
import { TenantSwitcher } from "@/components/dashboard/tenant-switcher";
import { UserMenu } from "@/components/dashboard/user-menu";
import { Badge } from "@/components/ui/badge";
import { dataMode } from "@/lib/data";
import { toTenantOption } from "@/lib/types";
import { getCurrentTenant, NoWorkspaceAccessError } from "@/lib/tenant/current";
import { signOut } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

function NoAccess({ email }: { email: string }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-lg font-semibold">No workspace yet</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        {email} is signed in but hasn’t been added to a workspace. Ask a MeSquared administrator to add you.
      </p>
      <form action={signOut}>
        <Button type="submit" variant="outline">Sign out</Button>
      </form>
    </main>
  );
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  let resolved;
  try {
    resolved = await getCurrentTenant();
  } catch (error) {
    if (error instanceof NoWorkspaceAccessError) return <NoAccess email={error.email} />;
    throw error;
  }
  const { user, tenant, tenants } = resolved;
  const options = tenants.map(toTenantOption);
  const current = toTenantOption(tenant);

  return (
    <div className="flex min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to content
      </a>

      <aside className="hidden w-64 shrink-0 flex-col gap-6 border-r bg-sidebar p-4 md:flex">
        <div className="flex items-center gap-2 px-1">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground" aria-hidden="true">
            M²
          </span>
          <span className="text-sm font-semibold tracking-tight">MeSquared OS</span>
        </div>
        <TenantSwitcher current={current} tenants={options} />
        <SidebarNav />
        <div className="mt-auto flex flex-col gap-3">
          <UserMenu user={user} />
          <div className="flex flex-col gap-2 px-1 text-xs text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>Data source</span>
              <Badge variant={dataMode === "postgres" ? "muted" : "secondary"}>{dataMode === "postgres" ? "PostgreSQL" : "Demo"}</Badge>
            </div>
            <span>
              {tenant.timezone} · {tenant.currency}
            </span>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-col md:hidden">
          <div className="flex h-14 items-center gap-3 border-b px-4">
            <span className="text-sm font-semibold">MeSquared OS</span>
            <div className="ml-auto flex items-center gap-2">
              <div className="w-44">
                <TenantSwitcher current={current} tenants={options} />
              </div>
              <UserMenu user={user} compact />
            </div>
          </div>
          <MobileNav />
        </header>
        <main id="main" tabIndex={-1} className="flex-1 p-4 outline-none md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
