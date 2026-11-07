import { AppShell } from "@/components/shell/app-shell";
import { ConsoleContext } from "@/components/shell/console-context";
import { getConsoleContext } from "@/lib/auth/access";
import { dataMode, repository } from "@/lib/data";
import { toTenantOption } from "@/lib/types";
import { templateName } from "@/lib/templates";

export const dynamic = "force-dynamic";

/** The status bar matches the console's navy header. */
export const viewport = { themeColor: "#182533" };

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const { user, tenants } = await getConsoleContext();
  const queue = await repository.listExceptions(
    tenants.map((t) => t.tenant.id),
    { limit: 500 },
  );
  const toReview = user.isPlatformAdmin ? (await repository.listOnboardings({ limit: 200 })).filter((o) => o.status === "SUBMITTED").length : 0;
  const summary = `${tenants.length} workspace${tenants.length === 1 ? "" : "s"}${dataMode === "postgres" ? "" : " · demo data"}`;
  return (
    <AppShell
      user={user}
      tone="abyss"
      homeHref="/console"
      nav={[
        { href: "/console", label: "Portfolio", hint: `${tenants.length} workspace${tenants.length === 1 ? "" : "s"}`, icon: "layoutGrid", exact: true, catchAll: true },
        { href: "/console/queue", label: "Queue", hint: "Needs an operator", icon: "inbox", badge: queue.length },
        ...(user.isPlatformAdmin
          ? [
              { href: "/console/onboarding", label: "Onboarding", hint: "Client questionnaires", icon: "fileCheck" as const, badge: toReview },
              { href: "/console/new", label: "New workspace", short: "New", hint: "Set up a client", icon: "plus" as const },
            ]
          : []),
      ]}
      context={<ConsoleContext workspaces={tenants.map((t) => toTenantOption(t.tenant))} summary={summary} />}
      commands={[
        {
          label: "Workspaces",
          items: tenants.flatMap(({ tenant: t }) => [
            { href: `/console/${t.slug}`, label: t.name, hint: templateName(t.templateKey) },
            { href: `/console/${t.slug}?tab=content`, label: `${t.name} · Content`, keywords: "drafts posts inbox", secondary: true },
            { href: `/console/${t.slug}?tab=money`, label: `${t.name} · Money`, keywords: "ads invoices links", secondary: true },
            { href: `/console/${t.slug}/settings`, label: `${t.name} · Settings`, keywords: "people keys modules automations launch", secondary: true },
            { href: `/console/queue?workspace=${t.slug}`, label: `${t.name} · Queue`, secondary: true },
            { href: `/app/${t.slug}`, label: `${t.name} · Client portal`, hint: "As the client sees it", secondary: true },
          ]),
        },
      ]}
    >
      {children}
    </AppShell>
  );
}
