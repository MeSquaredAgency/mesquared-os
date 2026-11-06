import Link from "next/link";
import { AgentSignoffs } from "@/components/portal/agent-signoffs";
import { ContentApprovals } from "@/components/portal/content-approvals";
import { HandledForYou } from "@/components/portal/handled-for-you";
import { MissedOpportunities } from "@/components/portal/missed-opportunities";
import { MoneyPanel } from "@/components/portal/money-panel";
import { NeedsYou } from "@/components/portal/needs-you";
import { Me2Person } from "@/components/shell/me2-person";
import { PageHeader } from "@/components/shell/section";
import { Button } from "@/components/ui/button";
import { latestCallBriefs } from "@/lib/agents/briefs";
import { loadClientSignoffs } from "@/lib/agents/views";
import { getPortalContext } from "@/lib/auth/access";
import { hasPermission } from "@/lib/auth/permissions";
import { repository } from "@/lib/data";
import { moduleOn } from "@/lib/modules/registry";
import { describeHandled } from "@/lib/portal/handled";

export const metadata = { title: "Home" };

/**
 * The client's home. It opens on what needs them; when nothing does, it says
 * so once and shows what was done for them. On a wide screen the work (what
 * needs you, what was handled) runs down the left and the money (at risk,
 * won back, this month) sits beside it; on a phone it is one column, work
 * first. Numbers live inside the section they explain, never in a strip of
 * their own at the top.
 */
export default async function PortalHomePage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { user, access } = await getPortalContext(slug);
  const tenant = access.tenant;
  const canViewFinances = hasPermission(access, "VIEW_FINANCES");
  const viewAll = hasPermission(access, "VIEW_ALL_RECORDS");
  const canApprove = hasPermission(access, "APPROVE_CONTENT");
  const [home, config] = await Promise.all([
    repository.getPortalHome(tenant.id, {
      timezone: tenant.timezone,
      currency: tenant.currency,
      onlyAssigneeId: viewAll ? null : user.id,
      canViewFinances,
    }),
    repository.getTenantConfig(tenant.id),
  ]);
  const [signoffs, briefs] = await Promise.all([
    // Only someone at the client can sign off an agent's message, so operators looking at the portal see none here.
    access.via === "member" ? loadClientSignoffs(tenant, { userId: user.id, canApprove }) : [],
    latestCallBriefs(tenant.id, home.needsYou.map((l) => l.id)),
  ]);
  const opportunitiesOn = moduleOn(config.modules, "opportunities");
  const fmt = { timezone: tenant.timezone, locale: tenant.locale, currency: tenant.currency };
  const base = `/app/${slug}`;
  const today = new Date().toLocaleDateString(tenant.locale, { timeZone: tenant.timezone, weekday: "long", day: "numeric", month: "long" });

  const leads = home.needsYou.length;
  const approvals = canApprove ? home.contentAwaiting.length : 0;
  const waiting = leads + approvals + signoffs.length;
  const done = describeHandled(home.handled.byType);
  const lede = waiting > 0 ? "Everything else is handled, with a person checking the work." : done ? `This week we ${done}, with a person checking the work.` : "Everything is handled, with a person checking the work.";

  const aside = (opportunitiesOn || home.money) && (
    <div className="flex flex-col gap-10">
      {opportunitiesOn && <MissedOpportunities missed={home.missed} fmt={fmt} allHref={`${base}/opportunities`} limit={4} />}
      {home.money && <MoneyPanel money={home.money} fmt={fmt} columns={2} />}
    </div>
  );

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        eyebrow={`${tenant.name} · ${today}`}
        title={headline(waiting, user.name)}
        lede={lede}
        actions={
          <>
            <Me2Person tenantId={tenant.id} />
            {waiting > 0 && (
              <Button asChild>
                <Link href={signoffs.length > 0 ? "#signoffs-title" : leads > 0 ? "#needs-you-title" : "#content-title"}>See what’s waiting</Link>
              </Button>
            )}
          </>
        }
      />

      <div className={aside ? "grid gap-10 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] xl:items-start xl:gap-x-8" : "flex flex-col gap-10"}>
        <div className="flex min-w-0 flex-col gap-10">
          {/* Always mounted for members, so the confirmation stays on screen after the last one is decided. */}
          {access.via === "member" && <AgentSignoffs tenantSlug={slug} items={signoffs} />}
          {leads > 0 && <NeedsYou leads={home.needsYou} fmt={fmt} allHref={`${base}/leads`} tenantSlug={slug} briefs={briefs} />}
          {home.contentAwaiting.length > 0 && <ContentApprovals tenantSlug={slug} assets={home.contentAwaiting} canApprove={canApprove} isMember={access.via === "member"} />}
          <HandledForYou handled={home.handled} activityHref={`${base}/activity`} />
        </div>
        {aside}
      </div>
    </div>
  );
}

const WORDS = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];

/** "Two things need you, Dana." / "Nothing needs you today, Dana." */
function headline(waiting: number, name: string | null) {
  const first = name?.trim().split(/\s+/)[0];
  const who = first ? `, ${first}.` : ".";
  if (waiting === 0) return `Nothing needs you today${who}`;
  const n = WORDS[waiting] ?? String(waiting);
  return waiting === 1 ? `One thing needs you${who}` : `${n} things need you${who}`;
}
