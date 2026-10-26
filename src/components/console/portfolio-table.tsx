import Link from "next/link";
import { AlertTriangle, PlugZap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/shell/section";
import { healthTone } from "@/lib/health";
import type { PortfolioRow } from "@/lib/types";
import { cn, formatMoney } from "@/lib/utils";

/** The score with the square as its status light: green, haze or coral. */
function Health({ score }: { score: number }) {
  const tone = healthTone(score);
  return (
    <span className="inline-flex items-center gap-2.5 text-lg num" title="Health: 100 minus deductions for SLA breaches, open missed opportunities, exceptions, failing integrations and ad pacing drift">
      <i className={cn("block size-2", tone === "good" && "bg-green", tone === "watch" && "bg-muted-foreground", tone === "bad" && "bg-brand")} aria-hidden="true" />
      {score}
      <span className="sr-only">{tone === "good" ? ", healthy" : tone === "watch" ? ", watch" : ", needs attention"}</span>
    </span>
  );
}

function Num({ value, warn = false }: { value: number; warn?: boolean }) {
  return <span className={cn("num", value > 0 && warn ? "font-medium text-red-text" : value === 0 ? "text-muted-foreground" : "")}>{value}</span>;
}

/** The core of the Operator Console: every tenant in the portfolio, worst health first. */
export function PortfolioTable({ rows }: { rows: PortfolioRow[] }) {
  if (rows.length === 0) return <Empty>No workspaces assigned to you yet.</Empty>;
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b">
            <th scope="col" className="px-6 py-4 font-medium">Workspace</th>
            <th scope="col" className="px-3 py-4 font-medium">Health</th>
            <th scope="col" className="px-3 py-4 font-medium">SLA breaches</th>
            <th scope="col" className="px-3 py-4 font-medium">Missed opps</th>
            <th scope="col" className="px-3 py-4 font-medium">At risk</th>
            <th scope="col" className="px-3 py-4 font-medium">Exceptions</th>
            <th scope="col" className="px-3 py-4 font-medium">Content due</th>
            <th scope="col" className="px-3 py-4 font-medium">Ad pacing</th>
            <th scope="col" className="px-3 py-4 font-medium">Integrations</th>
            <th scope="col" className="px-6 py-4 font-medium">Leads today</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => {
            const failing = r.integrations.filter((i) => i.status === "NEEDS_ATTENTION" || i.status === "DISCONNECTED");
            const pending = r.integrations.filter((i) => i.status === "PENDING");
            const pacing = r.adPacing ? r.adPacing.spentCents / Math.max(1, r.adPacing.budgetCents) : null;
            const expected = r.adPacing ? r.adPacing.daysElapsed / r.adPacing.daysInMonth : null;
            return (
              <tr key={r.tenant.id} className="transition-colors duration-300 hover:bg-accent/60">
                <td className="px-6 py-4">
                  <Link href={`/console/${r.tenant.slug}`} className="text-base font-medium hover:underline">
                    {r.tenant.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">{r.tenant.timezone}</p>
                </td>
                <td className="px-3 py-4">
                  <Health score={r.health} />
                </td>
                <td className="px-3 py-4">
                  <Num value={r.slaBreaches} warn />
                </td>
                <td className="px-3 py-4">
                  <Num value={r.missedOpen} warn />
                </td>
                <td className="px-3 py-4 num">{r.missedAtRiskCents > 0 ? formatMoney(r.missedAtRiskCents, r.tenant.currency, r.tenant.locale) : <span className="text-muted-foreground">–</span>}</td>
                <td className="px-3 py-4">
                  <Num value={r.exceptionsOpen} warn />
                </td>
                <td className="px-3 py-4">
                  <Num value={r.contentDue} />
                </td>
                <td className="px-3 py-4">
                  {pacing === null || expected === null ? (
                    <span className="text-muted-foreground">not connected</span>
                  ) : (
                    <span className={cn("num", Math.abs(pacing - expected) > 0.25 && "font-medium text-red-text")} title={`Spent ${Math.round(pacing * 100)}% of budget, ${Math.round(expected * 100)}% of month elapsed`}>
                      {Math.round(pacing * 100)}% / {Math.round(expected * 100)}%
                    </span>
                  )}
                </td>
                <td className="px-3 py-4">
                  <span className="inline-flex flex-wrap items-center gap-1">
                    {failing.length === 0 && pending.length === 0 ? <Badge variant="green">All connected</Badge> : null}
                    {failing.map((i) => (
                      <Badge key={i.provider} variant="red" title={i.lastError ?? undefined}>
                        <AlertTriangle /> {i.provider.toLowerCase().replace(/_/g, " ")}
                      </Badge>
                    ))}
                    {pending.map((i) => (
                      <Badge key={i.provider} variant="outline">
                        <PlugZap /> {i.provider.toLowerCase().replace(/_/g, " ")}
                      </Badge>
                    ))}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <Num value={r.leadsToday} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
