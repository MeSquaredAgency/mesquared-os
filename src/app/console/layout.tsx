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
  const toReview = user.isPlatformAdmin ? (await repository.listOnboardings({ limit: 200 })).filter((o) => o.status === "SUBMITTED").length : 0;
  return (
    <AppShell
      user={user}
      tone="abyss"
      nav={[
        { href: "/console", label: "Portfolio", hint: `${tenants.length} workspace${tenants.length === 1 ? "" : "s"}`, icon: "layoutGrid", exact: true },
        { href: "/console/queue", label: "Queue", hint: "Needs an operator", icon: "inbox", badge: queue.length },
        ...(user.isPlatformAdmin
          ? [
              { href: "/console/onboarding", label: "Onboarding", hint: "Client questionnaires", icon: "fileCheck" as const, badge: toReview },
              { href: "/console/new", label: "New workspace", hint: "Set up a client", icon: "plus" as const },
            ]
          : []),
      ]}
      context={
        <div className="rounded-xl border bg-card px-4 py-3">
          <p className="text-sm font-medium">Operator console</p>
          <p className="text-xs text-muted-foreground">{user.isPlatformAdmin ? "Platform admin" : "Assigned workspaces"}</p>
        </div>
      }
    >
      {children}
    </AppShell>
  );
}
