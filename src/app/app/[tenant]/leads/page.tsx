import { LeadRows, LiveLeads } from "@/components/portal/lead-rows";
import { PageHeader, Panel } from "@/components/shell/section";
import { getPortalContext } from "@/lib/auth/access";
import { hasPermission } from "@/lib/auth/permissions";
import { repository } from "@/lib/data";
import { isRealtimeConfigured, LIVE_LEADS_LIMIT, realtimeUrl, sealLeadsQuery, toLiveLeadRow } from "@/lib/realtime/server";

export const metadata = { title: "Leads" };

export default async function LeadsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { user, access } = await getPortalContext(slug);
  const tenant = access.tenant;
  const viewAll = hasPermission(access, "VIEW_ALL_RECORDS");
  const onlyAssigneeId = viewAll ? null : user.id;
  const config = await repository.getTenantConfig(tenant.id);
  const stageNames = Object.fromEntries(config.pipelines.flatMap((p) => p.stages.map((s) => [s.id, `${p.name} · ${s.name}`])));
  const fmt = { timezone: tenant.timezone, locale: tenant.locale };

  // With Neon Realtime the list stays live: the same tenant-scoped query is
  // rendered here as initial rows and sealed for the browser to subscribe to.
  let sealed = null;
  if (isRealtimeConfigured()) {
    try {
      sealed = await sealLeadsQuery(tenant.id, { onlyAssigneeId });
    } catch (error) {
      console.error("[realtime] could not seal the lead list; rendering it static", error instanceof Error ? error.message : error);
    }
  }
  const limit = sealed ? LIVE_LEADS_LIMIT : 100;
  const rows = (await repository.listRecentLeads(tenant.id, limit)).filter((l) => viewAll || l.assigneeId === user.id || l.assigneeId === null).map(toLiveLeadRow);

  return (
    <div className="flex flex-col gap-10">
      <PageHeader kicker="Leads" title={viewAll ? "Everyone who has enquired" : "Your leads"} lede={viewAll ? "Every enquiry, newest first, with how we read it and where it is up to." : "Your leads and any not yet assigned, newest first."} />
      <Panel>
        {sealed ? (
          <LiveLeads key={sealed.queryFingerprint} tenantSlug={slug} userId={user.id} realtimeUrl={realtimeUrl()} sealedQuery={sealed} rows={rows} fmt={fmt} stageNames={stageNames} />
        ) : (
          <LeadRows rows={rows} fmt={fmt} stageNames={stageNames} />
        )}
      </Panel>
    </div>
  );
}
