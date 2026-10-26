import Link from "next/link";
import { ContentApprovals } from "@/components/portal/content-approvals";
import { HandledForYou } from "@/components/portal/handled-for-you";
import { MissedOpportunities } from "@/components/portal/missed-opportunities";
import { MoneyPanel } from "@/components/portal/money-panel";
import { NeedsYou } from "@/components/portal/needs-you";
import { Hero } from "@/components/shell/hero";
import { Me2Person } from "@/components/shell/me2-person";
import { Stat, StatStrip } from "@/components/shell/section";
import { Button } from "@/components/ui/button";
import { getPortalContext } from "@/lib/auth/access";
import { hasPermission } from "@/lib/auth/permissions";
import { COPY } from "@/lib/copy";
import { repository } from "@/lib/data";
import { formatMoney } from "@/lib/utils";

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
  const today = new Date().toLocaleDateString(tenant.locale, { timeZone: tenant.timezone, weekday: "long", day: "numeric", month: "long" });
  const waiting = home.needsYou.length;

  return (
    <div className="flex flex-col gap-12">
      <Hero kicker={today} title={headline(waiting, user.name)} lede={`Everything else at ${tenant.name} is handled, with a person checking the work. Here’s where things stand.`} aside={<Me2Person tenantId={tenant.id} />}>
        {waiting > 0 && (
          <Button asChild>
            <Link href={`${base}/leads`}>See who’s waiting</Link>
          </Button>
        )}
        <Button asChild variant="outline">
          <Link href={`${base}/activity`}>What we handled</Link>
        </Button>
      </Hero>

      <StatStrip label="This month at a glance" columns={3}>
        <Stat label={COPY.atRisk[0].toUpperCase() + COPY.atRisk.slice(1)} value={formatMoney(home.missed.atRiskCents, fmt.currency, fmt.locale)} tone={home.missed.atRiskCents > 0 ? "red" : "neutral"} hint={`${home.missed.open.length} open`} />
        <Stat label={`${COPY.recovered} this month`} value={formatMoney(home.missed.recoveredCents, fmt.currency, fmt.locale)} tone={home.missed.recoveredCents > 0 ? "green" : "neutral"} hint="Won back for you" />
        <Stat label="Handled this week" value={home.handled.countWeek} hint={`${home.handled.countToday} today`} />
      </StatStrip>

      <NeedsYou leads={home.needsYou} fmt={fmt} allHref={`${base}/leads`} />
      <MissedOpportunities missed={home.missed} fmt={fmt} allHref={`${base}/opportunities`} />
      {home.money && <MoneyPanel money={home.money} fmt={fmt} />}
      <ContentApprovals tenantSlug={slug} assets={home.contentAwaiting} canApprove={hasPermission(access, "APPROVE_CONTENT")} isMember={access.via === "member"} />
      <HandledForYou handled={home.handled} activityHref={`${base}/activity`} />
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
