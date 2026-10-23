import { PortfolioTable } from "@/components/console/portfolio-table";
import { StatCard } from "@/components/shell/stat-card";
import { getConsoleContext } from "@/lib/auth/access";
import { repository } from "@/lib/data";

export const metadata = { title: "Portfolio" };

export default async function ConsolePage() {
  const { tenants } = await getConsoleContext();
  const rows = await repository.getPortfolio(tenants.map((t) => t.tenant));
  const totals = rows.reduce(
    (acc, r) => ({
      breaches: acc.breaches + r.slaBreaches,
      missed: acc.missed + r.missedOpen,
      exceptions: acc.exceptions + r.exceptionsOpen,
      content: acc.content + r.contentDue,
      failing: acc.failing + r.integrations.filter((i) => i.status === "NEEDS_ATTENTION" || i.status === "DISCONNECTED").length,
    }),
    { breaches: 0, missed: 0, exceptions: 0, content: 0, failing: 0 },
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Portfolio</h1>
        <p className="text-sm text-muted-foreground">Every workspace you run, worst health first.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="SLA breaches" value={totals.breaches} tone={totals.breaches ? "red" : "neutral"} />
        <StatCard label="Missed opportunities" value={totals.missed} tone={totals.missed ? "red" : "neutral"} />
        <StatCard label="Exceptions" value={totals.exceptions} tone={totals.exceptions ? "red" : "neutral"} />
        <StatCard label="Content due" value={totals.content} />
        <StatCard label="Failing integrations" value={totals.failing} tone={totals.failing ? "red" : "neutral"} />
      </div>
      <PortfolioTable rows={rows} />
    </div>
  );
}
