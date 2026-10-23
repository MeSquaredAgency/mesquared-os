import { AppShell } from "@/components/shell/app-shell";
import { getConsoleContext } from "@/lib/auth/access";
import { repository } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { user, tenants } = await getConsoleContext();
  const queue = await repository.listExceptions(
    tenants.map((t) => t.tenant.id),
    { limit: 500 },
  );
  return (
    <AppShell
      user={user}
      nav={[
        { href: "/console", label: "Portfolio", hint: `${tenants.length} workspace${tenants.length === 1 ? "" : "s"}`, icon: "layoutGrid", exact: true },
        { href: "/console/queue", label: "Queue", hint: "Needs an operator", icon: "inbox", badge: queue.length },
      ]}
      context={
        <div className="rounded-md border bg-background px-3 py-2">
          <p className="text-sm font-medium">Operator Console</p>
          <p className="text-[11px] text-muted-foreground">{user.isPlatformAdmin ? "Platform admin" : "Assigned workspaces"}</p>
        </div>
      }
    >
      {children}
    </AppShell>
  );
}
