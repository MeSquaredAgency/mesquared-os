import Link from "next/link";
import { PortfolioTable } from "@/components/console/portfolio-table";
import { Hero } from "@/components/shell/hero";
import { Section, Stat, StatStrip } from "@/components/shell/section";
import { Button } from "@/components/ui/button";
import { getConsoleContext } from "@/lib/auth/access";
import { repository } from "@/lib/data";

export const metadata = { title: "Portfolio" };

export default async function ConsolePage() {
  const { tenants, user } = await getConsoleContext();
  const rows = await repository.getPortfolio(tenants.map((t) => t.tenant));
  const totals = rows.reduce(
    (acc, r) => ({
      breaches: acc.breaches + r.slaBreaches,
      missed: acc.missed + r.missedOpen,
      exceptions: acc.exceptions + r.exceptionsOpen,
      content: acc.content + r.contentDue,
      failing: acc.failing + r.integrations.filter((i) => i.status === "NEEDS_ATTENTION" || i.status === "DISCONNECTED").length,
      leads: acc.leads + r.leadsToday,
    }),
    { breaches: 0, missed: 0, exceptions: 0, content: 0, failing: 0, leads: 0 },
  );
  const needsPerson = totals.breaches + totals.exceptions + totals.failing;
  const first = user.name?.trim().split(/\s+/)[0];
  const title =
    rows.length === 0 ? "No workspaces yet." : needsPerson === 0 ? `All ${rows.length} workspace${rows.length === 1 ? "" : "s"} running clean${first ? `, ${first}` : ""}.` : `${needsPerson} thing${needsPerson === 1 ? "" : "s"} need${needsPerson === 1 ? "s" : ""} a person across ${rows.length} workspace${rows.length === 1 ? "" : "s"}.`;

  return (
    <div className="flex flex-col gap-12">
      <Hero kicker="Portfolio" title={title} lede={`${totals.leads} lead${totals.leads === 1 ? "" : "s"} in today. Breaches, exceptions and failing integrations first; everything else is on schedule.`}>
        {totals.exceptions > 0 && (
          <Button asChild>
            <Link href="/console/queue">Work the queue</Link>
          </Button>
        )}
        <Button asChild variant="outline">
          <Link href="/console/new">New workspace</Link>
        </Button>
      </Hero>

      <StatStrip label="Across the portfolio" columns={5}>
        <Stat label="SLA breaches" value={totals.breaches} tone={totals.breaches ? "red" : "neutral"} />
        <Stat label="Missed opportunities" value={totals.missed} tone={totals.missed ? "red" : "neutral"} />
        <Stat label="Exceptions" value={totals.exceptions} tone={totals.exceptions ? "red" : "neutral"} />
        <Stat label="Content due" value={totals.content} />
        <Stat label="Failing integrations" value={totals.failing} tone={totals.failing ? "red" : "neutral"} />
      </StatStrip>

      <Section id="portfolio-title" title="Every workspace, worst health first" lede="Health is 100 minus deductions for breaches, open missed opportunities, exceptions, failing integrations and ad pacing drift.">
        <PortfolioTable rows={rows} />
      </Section>
    </div>
  );
}
