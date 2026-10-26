import { ChannelSummaryCard } from "@/components/portal/channel-summary";
import { ContentApprovals } from "@/components/portal/content-approvals";
import { ContentCalendar } from "@/components/portal/content-calendar";
import { PortalInbox } from "@/components/portal/portal-inbox";
import { Empty, PageHeader, Panel, Section } from "@/components/shell/section";
import { StatusBadge } from "@/components/shell/status-badge";
import { PLATFORM_LABEL } from "@/components/shell/platform";
import { getPortalContext } from "@/lib/auth/access";
import { hasPermission } from "@/lib/auth/permissions";
import { buildCalendar } from "@/lib/content/calendar";
import { repository } from "@/lib/data";
import { summarizeChannels } from "@/lib/social/metrics";
import { getTenantObjectUrl, isStorageConfigured, storageKeyFromFileUrl } from "@/lib/storage";
import { formatDateTime, humanize } from "@/lib/utils";

export const metadata = { title: "Content" };

export default async function ContentPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { access } = await getPortalContext(slug);
  const tenant = access.tenant;
  const canApprove = hasPermission(access, "APPROVE_CONTENT");
  // Customer conversations from social channels belong to the business, not to one person's leads: only people who see all records get the inbox.
  const canSeeInbox = hasPermission(access, "VIEW_ALL_RECORDS");
  const [wb, snapshots, inbox] = await Promise.all([repository.getWorkbench(tenant.id), repository.listChannelMetrics(tenant.id, { since: new Date(Date.now() - 14 * 86_400_000) }), canSeeInbox ? repository.listInboxConversations(tenant.id, { awaitingOnly: true, limit: 30 }) : Promise.resolve([])]);
  const threads = await Promise.all(inbox.map(async (conversation) => ({ conversation, messages: await repository.listMessages(tenant.id, conversation.id, 10) })));
  const fmt = { timezone: tenant.timezone, locale: tenant.locale };
  const decided = wb.assets.filter((a) => a.status !== "IN_REVIEW" && a.status !== "DRAFT").slice(0, 12);
  const calendar = buildCalendar(tenant, wb.posts, wb.assets, new Date(), 14);
  const summaries = summarizeChannels(wb.channels, snapshots);
  const waiting = wb.assets.filter((a) => a.status === "IN_REVIEW").length;

  // Files on object storage are read through short-lived presigned URLs minted here, per tenant.
  const fileLinks: Record<string, string> = {};
  if (isStorageConfigured()) {
    await Promise.all(
      wb.assets.map(async (a) => {
        const key = storageKeyFromFileUrl(a.fileUrl);
        if (!key) return;
        try {
          fileLinks[a.id] = await getTenantObjectUrl(tenant.id, key, 3600);
        } catch (error) {
          console.error("[storage] could not presign asset", a.id, error instanceof Error ? error.message : error);
        }
      }),
    );
  }

  return (
    <div className="flex flex-col gap-12">
      <PageHeader
        kicker="Content"
        title={waiting === 0 ? "Nothing waiting for you" : `${waiting} draft${waiting === 1 ? "" : "s"} waiting for your say`}
        lede={`Drafts for ${wb.connectedPlatforms.map((p) => PLATFORM_LABEL[p]).join(", ") || "your channels"}, the calendar, your channel numbers and the inbox. Approve what goes live; the rest is handled.`}
      />
      <ContentApprovals tenantSlug={slug} assets={wb.assets} fileLinks={fileLinks} canApprove={canApprove} isMember={access.via === "member"} />
      <ContentCalendar days={calendar} fmt={fmt} />
      <div className="grid gap-12 xl:grid-cols-2 xl:gap-8">
        <ChannelSummaryCard summaries={summaries} fmt={fmt} />
        <Section id="decided-title" title="Decided" lede="Approved drafts are on the calendar; sent-back ones went to Me² to rework.">
          {decided.length === 0 ? (
            <Empty>No decisions yet.</Empty>
          ) : (
            <Panel>
              <ul className="divide-y">
                {decided.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-4 py-4">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <p className="truncate text-base">{a.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {humanize(a.kind)}
                        {a.targetPlatform ? ` · ${PLATFORM_LABEL[a.targetPlatform]}` : ""}
                        {a.scheduledFor ? ` · ${formatDateTime(a.scheduledFor, fmt)}` : ""}
                        {fileLinks[a.id] && (
                          <>
                            {" · "}
                            <a className="underline underline-offset-4" href={fileLinks[a.id]} target="_blank" rel="noreferrer">
                              Download file
                            </a>
                          </>
                        )}
                      </p>
                    </div>
                    <StatusBadge status={a.status} />
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </Section>
      </div>
      {canSeeInbox && <PortalInbox tenantSlug={slug} threads={threads} canReply={canApprove} />}
    </div>
  );
}
