import { ContentApprovals } from "@/components/portal/content-approvals";
import { HandledForYou } from "@/components/portal/handled-for-you";
import { MissedOpportunities } from "@/components/portal/missed-opportunities";
import { MoneyPanel } from "@/components/portal/money-panel";
import { NeedsYou } from "@/components/portal/needs-you";
import { getPortalContext } from "@/lib/auth/access";
import { hasPermission } from "@/lib/auth/permissions";
import { repository } from "@/lib/data";

export const metadata = { title: "Home" };

export default async function PortalHomePage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { user, access } = await getPortalContext(slug);
  const tenant = access.tenant;
  const canViewFinances = hasPermission(access, "VIEW_FINANCES");
  const viewAll = hasPermission(access, "VIEW_ALL_RECORDS");
  const home = await repository.getPortalHome(tenant.id, {
    timezone: tenant.timezone,
    currency: tenant.currency,
    onlyAssigneeId: viewAll ? null : user.id,
    canViewFinances,
  });
  const fmt = { timezone: tenant.timezone, locale: tenant.locale, currency: tenant.currency };
  const base = `/app/${slug}`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{greeting(user.name)}</h1>
        <p className="text-sm text-muted-foreground">Here’s what needs you at {tenant.name}. Everything else is handled.</p>
      </div>
      <NeedsYou leads={home.needsYou} fmt={fmt} allHref={`${base}/leads`} />
      <MissedOpportunities missed={home.missed} fmt={fmt} allHref={`${base}/opportunities`} />
      {home.money && <MoneyPanel money={home.money} fmt={fmt} />}
      <ContentApprovals tenantSlug={slug} assets={home.contentAwaiting} canApprove={hasPermission(access, "APPROVE_CONTENT")} isMember={access.via === "member"} />
      <HandledForYou handled={home.handled} activityHref={`${base}/activity`} />
    </div>
  );
}

function greeting(name: string | null) {
  const first = name?.split(" ")[0];
  return first ? `Good day, ${first}` : "Good day";
}
