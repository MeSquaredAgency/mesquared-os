import Link from "next/link";
import { AlertTriangle, CheckCircle2, PlugZap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { healthTone } from "@/lib/health";
import type { PortfolioRow } from "@/lib/types";
import { cn, formatMoney } from "@/lib/utils";

function Health({ score }: { score: number }) {
  const tone = healthTone(score);
  return (
    <span
      className={cn(
        "inline-flex h-8 min-w-12 items-center justify-center rounded-md px-2 text-sm font-semibold tabular-nums",
        tone === "good" && "bg-green-soft text-green-text",
        tone === "watch" && "bg-secondary text-secondary-foreground",
        tone === "bad" && "bg-red-soft text-red-text",
      )}
      title="Health: 100 minus deductions for SLA breaches, open missed opportunities, exceptions, failing integrations and ad pacing drift"
    >
      {score}
    </span>
  );
}

function Num({ value, warn = false }: { value: number; warn?: boolean }) {
  return <span className={cn("tabular-nums", value > 0 && warn ? "font-semibold text-red-text" : value === 0 ? "text-muted-foreground" : "")}>{value}</span>;
}

/** The core of the Operator Console: every tenant in the portfolio, worst health first. */
export function PortfolioTable({ rows }: { rows: PortfolioRow[] }) {
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">No workspaces assigned to you yet.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr className="border-b">
            <th className="px-4 py-3 font-medium">Workspace</th>
            <th className="px-3 py-3 font-medium">Health</th>
            <th className="px-3 py-3 font-medium">SLA breaches</th>
            <th className="px-3 py-3 font-medium">Missed opps</th>
            <th className="px-3 py-3 font-medium">At risk</th>
            <th className="px-3 py-3 font-medium">Exceptions</th>
            <th className="px-3 py-3 font-medium">Content due</th>
            <th className="px-3 py-3 font-medium">Ad pacing</th>
            <th className="px-3 py-3 font-medium">Integrations</th>
            <th className="px-3 py-3 font-medium">Leads today</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => {
            const failing = r.integrations.filter((i) => i.status === "NEEDS_ATTENTION" || i.status === "DISCONNECTED");
            const pending = r.integrations.filter((i) => i.status === "PENDING");
            const pacing = r.adPacing ? r.adPacing.spentCents / Math.max(1, r.adPacing.budgetCents) : null;
            const expected = r.adPacing ? r.adPacing.daysElapsed / r.adPacing.daysInMonth : null;
            return (
              <tr key={r.tenant.id} className="hover:bg-muted/40">
                <td className="px-4 py-3">
                  <Link href={`/console/${r.tenant.slug}`} className="font-medium hover:underline">
                    {r.tenant.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">{r.tenant.timezone}</p>
                </td>
                <td className="px-3 py-3">
                  <Health score={r.health} />
                </td>
                <td className="px-3 py-3">
                  <Num value={r.slaBreaches} warn />
                </td>
                <td className="px-3 py-3">
                  <Num value={r.missedOpen} warn />
                </td>
                <td className="px-3 py-3 tabular-nums">{r.missedAtRiskCents > 0 ? formatMoney(r.missedAtRiskCents, r.tenant.currency, r.tenant.locale) : <span className="text-muted-foreground">–</span>}</td>
                <td className="px-3 py-3">
                  <Num value={r.exceptionsOpen} warn />
                </td>
                <td className="px-3 py-3">
                  <Num value={r.contentDue} />
                </td>
                <td className="px-3 py-3">
                  {pacing === null || expected === null ? (
                    <span className="text-muted-foreground">not connected</span>
                  ) : (
                    <span className={cn("tabular-nums", Math.abs(pacing - expected) > 0.25 && "font-semibold text-red-text")} title={`Spent ${Math.round(pacing * 100)}% of budget, ${Math.round(expected * 100)}% of month elapsed`}>
                      {Math.round(pacing * 100)}% / {Math.round(expected * 100)}%
                    </span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <span className="inline-flex flex-wrap items-center gap-1">
                    {failing.length === 0 && pending.length === 0 ? (
                      <Badge variant="green">
                        <CheckCircle2 /> ok
                      </Badge>
                    ) : null}
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
                <td className="px-3 py-3">
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
