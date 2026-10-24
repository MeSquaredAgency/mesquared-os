import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/shell/stat-card";
import { StatusBadge } from "@/components/shell/status-badge";
import type { AttributionReport } from "@/lib/attribution/report";
import type { PacingStatus } from "@/lib/ads/sync";
import type { SiteSummary } from "@/lib/website/rollup";
import type { InvoiceRecord, MoneySummary } from "@/lib/types";
import { formatDateTime, formatMoney, type FormatContext } from "@/lib/utils";

/** The Money page blocks: this month's numbers, invoices, where leads come from, and the website. Server components. */

export function MoneyHeadline({ money, pacing, fmt }: { money: MoneySummary; pacing: PacingStatus | null; fmt: FormatContext }) {
  const m = (c: number) => formatMoney(c, fmt.currency, fmt.locale);
  return (
    <section aria-label="This month" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Revenue this month" value={m(money.revenueMonthCents)} tone="green" />
      <StatCard label="Profit this month" value={m(money.profitMonthCents ?? money.revenueMonthCents - money.adSpendMonthCents)} hint={`after ${m(money.expensesMonthCents ?? 0)} expenses and ${m(money.adSpendMonthCents)} ads`} tone={(money.profitMonthCents ?? 0) >= 0 ? "green" : "red"} />
      <StatCard label="Owed to you" value={m(money.outstandingCents ?? 0)} hint={money.overdueCount ? `${money.overdueCount} overdue, ${m(money.overdueCents ?? 0)}` : "nothing overdue"} tone={money.overdueCount ? "red" : undefined} />
      <StatCard label="Ad spend this month" value={m(money.adSpendMonthCents)} hint={pacing && pacing.driftPct !== null ? `${pacing.driftPct > 0 ? "+" : ""}${pacing.driftPct}% vs plan of ${m(pacing.budgetCents)}` : money.adSpendMonthCents ? "no budget set" : "no ad accounts connected"} />
    </section>
  );
}

export function InvoicesCard({ invoices, fmt, title = "Invoices", description = "Sent and overdue invoices from your accounting system. Reminders go out automatically." }: { invoices: InvoiceRecord[]; fmt: FormatContext; title?: string; description?: string }) {
  const open = invoices.filter((i) => i.status === "SENT" || i.status === "OVERDUE");
  return (
    <Card aria-labelledby="invoices-title">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle id="invoices-title">{title}</CardTitle>
          <CardDescription className="mt-1">{description}</CardDescription>
        </div>
        <Badge variant={open.some((i) => i.status === "OVERDUE") ? "red" : open.length ? "secondary" : "muted"}>{open.length} open</Badge>
      </CardHeader>
      <CardContent>
        {invoices.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No invoices yet. Connect Xero, Square or Stripe and they appear here.</p>
        ) : (
          <ul className="divide-y">
            {invoices.slice(0, 12).map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    {i.number ? `#${i.number}` : "Invoice"} · {i.customerName ?? i.customerEmail ?? "customer"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {i.dueAt ? `${i.status === "PAID" ? "paid" : "due"} ${formatDateTime(i.paidAt ?? i.dueAt, fmt).replace(/,.*$/, "")}` : ""}
                    {i.remindersSent ? ` · ${i.remindersSent} reminder${i.remindersSent === 1 ? "" : "s"} sent` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm font-medium">{formatMoney(i.status === "PAID" ? i.amountCents : i.amountDueCents, i.currency, fmt.locale)}</span>
                  <StatusBadge status={i.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function AttributionCard({ report, fmt }: { report: AttributionReport; fmt: FormatContext }) {
  const m = (c: number | null) => (c === null ? "–" : formatMoney(c, fmt.currency, fmt.locale));
  return (
    <Card aria-labelledby="attribution-title">
      <CardHeader>
        <CardTitle id="attribution-title">Where leads come from</CardTitle>
        <CardDescription>Last 30 days: spend, leads and revenue by channel. Cost per lead is spend ÷ leads; revenue per $ is revenue ÷ spend.</CardDescription>
      </CardHeader>
      <CardContent>
        {report.rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No leads in this period yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-3 font-medium">Channel</th>
                  <th className="py-1.5 pr-3 font-medium">Spend</th>
                  <th className="py-1.5 pr-3 font-medium">Leads</th>
                  <th className="py-1.5 pr-3 font-medium">Booked</th>
                  <th className="py-1.5 pr-3 font-medium">Won</th>
                  <th className="py-1.5 pr-3 font-medium">Revenue</th>
                  <th className="py-1.5 pr-3 font-medium">Cost / lead</th>
                  <th className="py-1.5 pr-3 font-medium">Revenue / $</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {report.rows.map((r) => (
                  <tr key={r.key}>
                    <td className="py-2 pr-3">
                      <span className="font-medium capitalize">{r.source.replace(/_/g, " ")}</span>
                      {r.campaign && <span className="text-muted-foreground"> · {r.campaign}</span>}
                    </td>
                    <td className="py-2 pr-3">{m(r.spendCents)}</td>
                    <td className="py-2 pr-3">{r.leads}</td>
                    <td className="py-2 pr-3">{r.booked}</td>
                    <td className="py-2 pr-3">{r.won}</td>
                    <td className="py-2 pr-3">{m(r.revenueCents)}</td>
                    <td className="py-2 pr-3">{m(r.costPerLeadCents)}</td>
                    <td className="py-2 pr-3">{r.roas === null ? "–" : `${r.roas.toFixed(1)}×`}</td>
                  </tr>
                ))}
                <tr className="font-medium">
                  <td className="py-2 pr-3">All channels</td>
                  <td className="py-2 pr-3">{m(report.totals.spendCents)}</td>
                  <td className="py-2 pr-3">{report.totals.leads}</td>
                  <td className="py-2 pr-3">{report.totals.booked}</td>
                  <td className="py-2 pr-3">{report.totals.won}</td>
                  <td className="py-2 pr-3">{m(report.totals.revenueCents)}</td>
                  <td className="py-2 pr-3">{m(report.totals.costPerLeadCents)}</td>
                  <td className="py-2 pr-3">{report.totals.roas === null ? "–" : `${report.totals.roas.toFixed(1)}×`}</td>
                </tr>
              </tbody>
            </table>
            {report.unattributed > 0 && <p className="mt-2 text-xs text-muted-foreground">{report.unattributed} lead{report.unattributed === 1 ? "" : "s"} arrived with no campaign on them (direct, phone or email).</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function WebsiteCard({ site, fmt }: { site: SiteSummary; fmt: FormatContext }) {
  const n = (v: number) => v.toLocaleString(fmt.locale);
  return (
    <Card aria-labelledby="website-title">
      <CardHeader>
        <CardTitle id="website-title">Your website, last 7 days</CardTitle>
        <CardDescription>From the site beacon: visits, pages, and how many visitors start and finish a form.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {site.days.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No website numbers yet. Add the beacon snippet to the site and they appear within a day.</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <StatCard label="Visits" value={n(site.sessions7d)} hint={site.sessionsChange !== null ? `${site.sessionsChange > 0 ? "+" : ""}${site.sessionsChange}% vs the week before` : undefined} />
              <StatCard label="Page views" value={n(site.pageviews7d)} />
              <StatCard label="Forms started" value={n(site.formStarts7d)} />
              <StatCard label="Forms sent" value={n(site.formSubmits7d)} hint={site.formConversion !== null ? `${Math.round(site.formConversion * 100)}% of starts` : undefined} tone="green" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Top pages</p>
                <ul className="text-sm">
                  {Object.entries(site.topPages).map(([p, v]) => (
                    <li key={p} className="flex justify-between py-0.5">
                      <span className="truncate">{p}</span>
                      <span className="text-muted-foreground">{n(v)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Where visitors came from</p>
                <ul className="text-sm">
                  {Object.entries(site.topSources).map(([s, v]) => (
                    <li key={s} className="flex justify-between py-0.5">
                      <span className="truncate capitalize">{s}</span>
                      <span className="text-muted-foreground">{n(v)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
