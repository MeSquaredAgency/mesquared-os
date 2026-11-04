import { AppShell } from "@/components/shell/app-shell";
import { WorkspaceSwitcher } from "@/components/shell/workspace-switcher";
import { getPortalContext } from "@/lib/auth/access";
import { hasPermission } from "@/lib/auth/permissions";
import { COPY } from "@/lib/copy";
import { repository } from "@/lib/data";
import { moduleOn } from "@/lib/modules/registry";
import { toTenantOption } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children, params }: { children: React.ReactNode; params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { user, access, tenants } = await getPortalContext(slug);
  const base = `/app/${slug}`;
  const config = await repository.getTenantConfig(access.tenant.id);
  const inventoryOn = moduleOn(config.modules, "inventory");
  const opportunitiesOn = moduleOn(config.modules, "opportunities");
  const operator = user.isOperator || user.isPlatformAdmin;
  const others = tenants.filter((t) => t.tenant.slug !== slug);
  return (
    <AppShell
      user={user}
      tone="paper"
      homeHref={base}
      nav={[
        { href: base, label: "Home", hint: COPY.needsYou, icon: "home", exact: true },
        { href: `${base}/leads`, label: "Leads", hint: "Everyone who enquired", icon: "users" },
        ...(opportunitiesOn ? [{ href: `${base}/opportunities`, label: COPY.missedOpportunities, short: "Missed", hint: "Money at risk", icon: "trendingDown" as const }] : []),
        ...(hasPermission(access, "VIEW_FINANCES") ? [{ href: `${base}/money`, label: "Money", hint: "Revenue, ads, invoices", icon: "wallet" as const }] : []),
        { href: `${base}/content`, label: "Content", hint: "Approve drafts", icon: "fileCheck" },
        ...(inventoryOn ? [{ href: `${base}/inventory`, label: access.tenant.industry === "REAL_ESTATE" ? "Listings" : "Inventory", hint: "What is on the books", icon: "boxes" as const }] : []),
        { href: `${base}/activity`, label: COPY.activityLog, short: "Activity", hint: COPY.handledForYou, icon: "activity" },
      ]}
      back={operator ? { href: `/console/${slug}`, label: "Back to console" } : undefined}
      context={<WorkspaceSwitcher current={toTenantOption(access.tenant)} options={tenants.map((t) => toTenantOption(t.tenant))} basePath="/app" keep={["/leads", "/content", "/activity"]} />}
      commands={others.length ? [{ label: "Businesses", items: others.map(({ tenant: t }) => ({ href: `/app/${t.slug}`, label: t.name })) }] : []}
      footer={
        <span>
          {access.roleName ?? (access.via === "admin" ? "Platform admin" : "Operator")} · {access.tenant.timezone}
        </span>
      }
    >
      {children}
    </AppShell>
  );
}
