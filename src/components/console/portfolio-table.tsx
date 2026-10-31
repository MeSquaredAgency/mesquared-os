import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Empty } from "@/components/shell/section";
import { healthTone } from "@/lib/health";
import type { PortfolioRow } from "@/lib/types";
import { cn, formatMoney, humanize } from "@/lib/utils";

const TONE_LABEL = { good: "Healthy", watch: "Watch", bad: "Needs attention" } as const;

/** The score as a labelled bar, so 68 means something at a glance. */
export function HealthBar({ score, compact = false }: { score: number; compact?: boolean }) {
  const tone = healthTone(score);
  return (
    <span className="inline-flex items-center gap-2.5" title={`${score} of 100: ${TONE_LABEL[tone]}`}>
      <span className="relative block h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <span className={cn("absolute inset-y-0 left-0 rounded-full", tone === "good" && "bg-green", tone === "watch" && "bg-amber", tone === "bad" && "bg-red")} style={{ width: `${score}%` }} />
      </span>
      <span className="text-sm font-medium num">{score}</span>
      {!compact && <span className="sr-only">, {TONE_LABEL[tone]}</span>}
    </span>
  );
}

function Num({ value, warn = false }: { value: number; warn?: boolean }) {
  return <span className={cn(value === 0 ? "text-subtle-foreground" : warn ? "font-medium text-red-text" : "")}>{value}</span>;
}

/** The core of the Operator Console: every tenant in the portfolio, worst health first. */
export function PortfolioTable({ rows }: { rows: PortfolioRow[] }) {
  if (rows.length === 0) return <Empty>No workspaces assigned to you yet.</Empty>;
  return (
    <div className="surface overflow-hidden">
      <Table className="min-w-[960px]">
        <THead>
          <TR className="hover:bg-transparent">
            <TH>Workspace</TH>
            <TH>Health</TH>
            <TH numeric>Breaches</TH>
            <TH numeric>Exceptions</TH>
            <TH numeric>Missed</TH>
            <TH numeric>At risk</TH>
            <TH numeric>Content due</TH>
            <TH numeric>Ad pacing</TH>
            <TH>Integrations</TH>
            <TH numeric>Leads today</TH>
            <TH>
              <span className="sr-only">Open</span>
            </TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => {
            const failing = r.integrations.filter((i) => i.status === "NEEDS_ATTENTION" || i.status === "DISCONNECTED");
            const pending = r.integrations.filter((i) => i.status === "PENDING");
            const pacing = r.adPacing ? r.adPacing.spentCents / Math.max(1, r.adPacing.budgetCents) : null;
            const expected = r.adPacing ? r.adPacing.daysElapsed / r.adPacing.daysInMonth : null;
            const drift = pacing !== null && expected !== null ? pacing - expected : null;
            const href = `/console/${r.tenant.slug}`;
            return (
              <TR key={r.tenant.id}>
                <TD>
                  <Link href={href} className="font-medium whitespace-nowrap hover:underline">
                    {r.tenant.name}
                  </Link>
                  <p className="text-xs whitespace-nowrap text-muted-foreground">
                    {humanize(r.tenant.industry)} · {r.tenant.timezone.split("/").pop()?.replace(/_/g, " ")}
                  </p>
                </TD>
                <TD>
                  <HealthBar score={r.health} />
                </TD>
                <TD numeric>
                  <Num value={r.slaBreaches} warn />
                </TD>
                <TD numeric>
                  <Num value={r.exceptionsOpen} warn />
                </TD>
                <TD numeric>
                  <Num value={r.missedOpen} warn />
                </TD>
                <TD numeric>{r.missedAtRiskCents > 0 ? <span className="font-medium text-red-text">{formatMoney(r.missedAtRiskCents, r.tenant.currency, r.tenant.locale)}</span> : <span className="text-subtle-foreground">–</span>}</TD>
                <TD numeric>
                  <Num value={r.contentDue} />
                </TD>
                <TD numeric>
                  {pacing === null || expected === null || drift === null ? (
                    <span className="text-subtle-foreground">–</span>
                  ) : (
                    <span className={cn(Math.abs(drift) > 0.25 && "font-medium text-amber-text")} title={`Spent ${Math.round(pacing * 100)}% of budget with ${Math.round(expected * 100)}% of the month gone`}>
                      {drift > 0 ? "+" : ""}
                      {Math.round(drift * 100)}%
                    </span>
                  )}
                </TD>
                <TD>
                  <span className="inline-flex flex-wrap items-center gap-1">
                    {failing.length === 0 && pending.length === 0 ? <Badge variant="green">All connected</Badge> : null}
                    {failing.map((i) => (
                      <Badge key={i.provider} variant="red" title={i.lastError ?? undefined}>
                        {humanize(i.provider)}
                      </Badge>
                    ))}
                    {pending.map((i) => (
                      <Badge key={i.provider} variant="amber">
                        {humanize(i.provider)} pending
                      </Badge>
                    ))}
                  </span>
                </TD>
                <TD numeric>
                  <Num value={r.leadsToday} />
                </TD>
                <TD className="w-10 pr-3 pl-0">
                  <Link href={href} aria-label={`Open ${r.tenant.name}`} className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground">
                    <ChevronRight className="size-4" />
                  </Link>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}
