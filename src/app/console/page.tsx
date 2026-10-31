import Link from "next/link";
import { Plus } from "lucide-react";
import { PortfolioTable } from "@/components/console/portfolio-table";
import { PageHeader, Section, Stat, StatStrip } from "@/components/shell/section";
import { Button } from "@/components/ui/button";
import { getConsoleContext } from "@/lib/auth/access";
import { repository } from "@/lib/data";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Portfolio" };

export default async function ConsolePage() {
  const { tenants, user } = await getConsoleContext();
  const rows = await repository.getPortfolio(tenants.map((t) => t.tenant));
  const totals = rows.reduce(
    (acc, r) => ({
      breaches: acc.breaches + r.slaBreaches,
      missed: acc.missed + r.missedOpen,
      atRisk: acc.atRisk + r.missedAtRiskCents,
      exceptions: acc.exceptions + r.exceptionsOpen,
      content: acc.content + r.contentDue,
      failing: acc.failing + r.integrations.filter((i) => i.status === "NEEDS_ATTENTION" || i.status === "DISCONNECTED").length,
      leads: acc.leads + r.leadsToday,
    }),
    { breaches: 0, missed: 0, atRisk: 0, exceptions: 0, content: 0, failing: 0, leads: 0 },
  );
  const needsPerson = totals.breaches + totals.exceptions + totals.failing;
  const n = rows.length;
  const workspaces = `${n} workspace${n === 1 ? "" : "s"}`;
  // Money across workspaces is only comparable when they share a currency; fall back to the first one's.
  const currency = rows[0]?.tenant.currency ?? "AUD";
  const locale = rows[0]?.tenant.locale ?? "en-AU";
  const lede =
    n === 0
      ? "No workspaces are assigned to you yet."
      : needsPerson === 0
        ? `All ${workspaces} running clean. ${totals.leads} lead${totals.leads === 1 ? "" : "s"} in today.`
        : `${needsPerson} thing${needsPerson === 1 ? "" : "s"} need${needsPerson === 1 ? "s" : ""} a person across ${workspaces}: breaches, exceptions and failing integrations first.`;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Operator console"
        title="Portfolio"
        lede={lede}
        actions={
          <>
            {user.isPlatformAdmin && (
              <Button asChild variant="outline">
                <Link href="/console/new">
                  <Plus /> New workspace
                </Link>
              </Button>
            )}
            {totals.exceptions > 0 && (
              <Button asChild>
                <Link href="/console/queue">Work the queue</Link>
              </Button>
            )}
          </>
        }
      />

      <StatStrip label="Across the portfolio" columns={4}>
        <Stat label="Need a person" value={needsPerson} tone={needsPerson ? "red" : "neutral"} hint={`${totals.breaches} breach${totals.breaches === 1 ? "" : "es"} · ${totals.exceptions} exception${totals.exceptions === 1 ? "" : "s"} · ${totals.failing} failing`} />
        <Stat label="Money at risk" value={formatMoney(totals.atRisk, currency, locale)} tone={totals.atRisk ? "red" : "neutral"} hint={`${totals.missed} open missed opportunit${totals.missed === 1 ? "y" : "ies"}`} />
        <Stat label="Content due" value={totals.content} hint="Drafts waiting on approval" />
        <Stat label="Leads today" value={totals.leads} hint="Across every workspace" />
      </StatStrip>

      <Section id="portfolio-title" title="Workspaces" lede="Worst health first. Health is 100 minus deductions for breaches, open missed opportunities, exceptions, failing integrations and ad pacing drift." action={<span className="text-xs text-muted-foreground">{workspaces}</span>}>
        <PortfolioTable rows={rows} />
      </Section>
    </div>
  );
}
