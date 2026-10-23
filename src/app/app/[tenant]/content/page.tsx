import { ContentApprovals } from "@/components/portal/content-approvals";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shell/status-badge";
import { PLATFORM_LABEL } from "@/components/shell/platform";
import { getPortalContext } from "@/lib/auth/access";
import { hasPermission } from "@/lib/auth/permissions";
import { repository } from "@/lib/data";
import { formatDateTime, humanize } from "@/lib/utils";

export const metadata = { title: "Content" };

export default async function ContentPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { access } = await getPortalContext(slug);
  const tenant = access.tenant;
  const wb = await repository.getWorkbench(tenant.id);
  const fmt = { timezone: tenant.timezone, locale: tenant.locale };
  const decided = wb.assets.filter((a) => a.status !== "IN_REVIEW");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Content</h1>
        <p className="text-sm text-muted-foreground">
          Drafts from the engine for {wb.connectedPlatforms.map((p) => PLATFORM_LABEL[p]).join(", ") || "your channels"}. Approve what goes live.
        </p>
      </div>
      <ContentApprovals tenantSlug={slug} assets={wb.assets} canApprove={hasPermission(access, "APPROVE_CONTENT")} isMember={access.via === "member"} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card aria-labelledby="decided-title">
          <CardHeader>
            <CardTitle id="decided-title">Decided</CardTitle>
            <CardDescription>Approved drafts move to scheduling; sent-back ones go to the engine.</CardDescription>
          </CardHeader>
          <CardContent>
            {decided.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No decisions yet.</p>
            ) : (
              <ul className="divide-y">
                {decided.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm">{a.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {humanize(a.kind)}
                        {a.targetPlatform ? ` · ${PLATFORM_LABEL[a.targetPlatform]}` : ""}
                      </p>
                    </div>
                    <StatusBadge status={a.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card aria-labelledby="queue-title">
          <CardHeader>
            <CardTitle id="queue-title">Scheduled</CardTitle>
            <CardDescription>What’s going out, by channel.</CardDescription>
          </CardHeader>
          <CardContent>
            {wb.posts.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nothing scheduled.</p>
            ) : (
              <ul className="divide-y">
                {wb.posts.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 py-3">
                    <span className="w-24 shrink-0 text-xs text-muted-foreground">{PLATFORM_LABEL[p.platform]}</span>
                    <p className="min-w-0 flex-1 truncate text-sm">{p.caption}</p>
                    <span className="shrink-0 text-xs text-muted-foreground">{p.scheduledFor ? formatDateTime(p.scheduledFor, fmt) : "unscheduled"}</span>
                    <StatusBadge status={p.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
