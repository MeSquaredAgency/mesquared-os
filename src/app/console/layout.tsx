import { AppShell } from "@/components/shell/app-shell";
import { getConsoleContext } from "@/lib/auth/access";
import { dataMode, repository } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { user, tenants } = await getConsoleContext();
  const queue = await repository.listExceptions(
    tenants.map((t) => t.tenant.id),
    { limit: 500 },
  );
  const toReview = user.isPlatformAdmin ? (await repository.listOnboardings({ limit: 200 })).filter((o) => o.status === "SUBMITTED").length : 0;
  return (
    <AppShell
      user={user}
      tone="abyss"
      homeHref="/console"
      nav={[
        { href: "/console", label: "Portfolio", hint: `${tenants.length} workspace${tenants.length === 1 ? "" : "s"}`, icon: "layoutGrid", exact: true },
        { href: "/console/queue", label: "Queue", hint: "Needs an operator", icon: "inbox", badge: queue.length },
        ...(user.isPlatformAdmin
          ? [
              { href: "/console/onboarding", label: "Onboarding", hint: "Client questionnaires", icon: "fileCheck" as const, badge: toReview },
              { href: "/console/new", label: "New workspace", short: "New", hint: "Set up a client", icon: "plus" as const },
            ]
          : []),
      ]}
      context={
        <div className="flex items-center gap-2.5 rounded-md border border-sidebar-border bg-sidebar-active px-2.5 py-2">
          <span aria-hidden="true" className="block size-2 bg-brand" />
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="truncate text-sm font-medium">Operator console</span>
            <span className="truncate text-2xs text-sidebar-muted">
              {tenants.length} workspace{tenants.length === 1 ? "" : "s"}
              {dataMode === "postgres" ? "" : " · demo data"}
            </span>
          </div>
        </div>
      }
    >
      {children}
    </AppShell>
  );
}
