import { AppShell } from "@/components/shell/app-shell";
import { WorkspaceSwitcher } from "@/components/shell/workspace-switcher";
import { getPortalContext } from "@/lib/auth/access";
import { hasPermission } from "@/lib/auth/permissions";
import { COPY } from "@/lib/copy";
import { repository } from "@/lib/data";
import { toTenantOption } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function PortalLayout({ children, params }: { children: React.ReactNode; params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { user, access, tenants } = await getPortalContext(slug);
  const base = `/app/${slug}`;
  const config = await repository.getTenantConfig(access.tenant.id);
  const inventoryOn = config.modules.some((m) => m.moduleKey === "inventory" && m.enabled);
  return (
    <AppShell
      user={user}
      nav={[
        { href: base, label: "Home", hint: COPY.needsYou, icon: "home", exact: true },
        { href: `${base}/leads`, label: "Leads", hint: "Everyone who enquired", icon: "users" },
        { href: `${base}/opportunities`, label: COPY.missedOpportunities, hint: "Money at risk", icon: "trendingDown" },
        ...(hasPermission(access, "VIEW_FINANCES") ? [{ href: `${base}/money`, label: "Money", hint: "Revenue, ads, invoices", icon: "wallet" as const }] : []),
        { href: `${base}/content`, label: "Content", hint: "Approve drafts", icon: "fileCheck" },
        ...(inventoryOn ? [{ href: `${base}/inventory`, label: access.tenant.industry === "REAL_ESTATE" ? "Listings" : "Inventory", hint: "What is on the books", icon: "boxes" as const }] : []),
        { href: `${base}/activity`, label: COPY.activityLog, hint: COPY.handledForYou, icon: "activity" },
      ]}
      context={<WorkspaceSwitcher current={toTenantOption(access.tenant)} options={tenants.map((t) => toTenantOption(t.tenant))} basePath="/app" />}
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
