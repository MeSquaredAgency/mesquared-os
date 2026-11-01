import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Empty } from "@/components/shell/section";
import { HEALTH_TONE_LABEL as TONE_LABEL, healthBreakdown, healthTitle, healthTone, pacingDrift, type HealthDeduction } from "@/lib/health";
import type { PortfolioRow } from "@/lib/types";
import { cn, formatMoney, humanize } from "@/lib/utils";

/** The score as a labelled bar, so 68 means something at a glance; hover for where the points went. */
export function HealthBar({ score, deductions, compact = false }: { score: number; deductions?: HealthDeduction[]; compact?: boolean }) {
  const tone = healthTone(score);
  return (
    <span className="inline-flex items-center gap-2.5" title={healthTitle(score, deductions)}>
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

/** The one line under a workspace name: what is costing it points, or where it is. */
function RowNote({ row, deductions }: { row: PortfolioRow; deductions: HealthDeduction[] }) {
  if (deductions.length === 0) {
    return (
      <p className="text-xs whitespace-nowrap text-muted-foreground">
        {humanize(row.tenant.industry)} · {row.tenant.timezone.split("/").pop()?.replace(/_/g, " ")}
      </p>
    );
  }
  return <p className={cn("text-xs", healthTone(row.health) === "bad" ? "text-red-text" : "text-muted-foreground")}>{deductions.map((d) => d.label).join(" · ")}</p>;
}

function Pacing({ row }: { row: PortfolioRow }) {
  const drift = pacingDrift(row.adPacing);
  if (drift === null || !row.adPacing) return <span className="text-subtle-foreground">–</span>;
  const spent = row.adPacing.spentCents / Math.max(1, row.adPacing.budgetCents);
  const expected = row.adPacing.daysElapsed / row.adPacing.daysInMonth;
  return (
    <span className={cn(Math.abs(drift) > 0.25 && "font-medium text-amber-text")} title={`Spent ${Math.round(spent * 100)}% of budget with ${Math.round(expected * 100)}% of the month gone`}>
      {drift > 0 ? "+" : ""}
      {Math.round(drift * 100)}%
    </span>
  );
}

function Integrations({ row }: { row: PortfolioRow }) {
  const failing = row.integrations.filter((i) => i.status === "NEEDS_ATTENTION" || i.status === "DISCONNECTED");
  const pending = row.integrations.filter((i) => i.status === "PENDING");
  return (
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
  );
}

/** The core of the Operator Console: every tenant in the portfolio, worst health first. A table on a desk, cards on a phone. */
export function PortfolioTable({ rows }: { rows: PortfolioRow[] }) {
  if (rows.length === 0) return <Empty>No workspaces assigned to you yet.</Empty>;
  const withBreakdown = rows.map((r) => ({ row: r, deductions: healthBreakdown(r), href: `/console/${r.tenant.slug}` }));
  return (
    <>
      <div className="surface hidden overflow-hidden md:block">
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
            {withBreakdown.map(({ row: r, deductions, href }) => (
              <TR key={r.tenant.id}>
                <TD>
                  <Link href={href} className="font-medium whitespace-nowrap hover:underline">
                    {r.tenant.name}
                  </Link>
                  <RowNote row={r} deductions={deductions} />
                </TD>
                <TD>
                  <HealthBar score={r.health} deductions={deductions} />
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
                  <Pacing row={r} />
                </TD>
                <TD>
                  <Integrations row={r} />
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
            ))}
          </TBody>
        </Table>
      </div>

      <ul className="flex flex-col gap-3 md:hidden">
        {withBreakdown.map(({ row: r, deductions, href }) => (
          <li key={r.tenant.id} className="surface flex flex-col gap-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link href={href} className="text-base font-medium hover:underline">
                  {r.tenant.name}
                </Link>
                <RowNote row={r} deductions={deductions} />
              </div>
              <HealthBar score={r.health} deductions={deductions} compact />
            </div>
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-2xs text-muted-foreground">Breaches</dt>
                <dd>
                  <Num value={r.slaBreaches} warn />
                </dd>
              </div>
              <div>
                <dt className="text-2xs text-muted-foreground">Exceptions</dt>
                <dd>
                  <Num value={r.exceptionsOpen} warn />
                </dd>
              </div>
              <div>
                <dt className="text-2xs text-muted-foreground">At risk</dt>
                <dd className="num">{r.missedAtRiskCents > 0 ? <span className="font-medium text-red-text">{formatMoney(r.missedAtRiskCents, r.tenant.currency, r.tenant.locale)}</span> : <span className="text-subtle-foreground">–</span>}</dd>
              </div>
            </dl>
            <div className="flex items-center justify-between gap-3">
              <Integrations row={r} />
              <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium whitespace-nowrap hover:underline">
                Open <ChevronRight className="size-4" aria-hidden="true" />
              </Link>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
