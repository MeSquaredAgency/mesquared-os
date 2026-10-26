import { Badge } from "@/components/ui/badge";
import { Empty, Panel, Section, Stat, StatStrip } from "@/components/shell/section";
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
    <StatStrip label="This month" columns={4}>
      <Stat label="Revenue this month" value={m(money.revenueMonthCents)} tone="green" />
      <Stat label="Profit this month" value={m(money.profitMonthCents ?? money.revenueMonthCents - money.adSpendMonthCents)} hint={`after ${m(money.expensesMonthCents ?? 0)} expenses and ${m(money.adSpendMonthCents)} ads`} tone={(money.profitMonthCents ?? 0) >= 0 ? "green" : "red"} />
      <Stat label="Owed to you" value={m(money.outstandingCents ?? 0)} hint={money.overdueCount ? `${money.overdueCount} overdue, ${m(money.overdueCents ?? 0)}` : "nothing overdue"} tone={money.overdueCount ? "red" : "neutral"} />
      <Stat label="Ad spend this month" value={m(money.adSpendMonthCents)} hint={pacing && pacing.driftPct !== null ? `${pacing.driftPct > 0 ? "+" : ""}${pacing.driftPct}% vs plan of ${m(pacing.budgetCents)}` : money.adSpendMonthCents ? "no budget set" : "no ad accounts connected"} />
    </StatStrip>
  );
}

export function InvoicesCard({ invoices, fmt, title = "Invoices", description = "Sent and overdue invoices from your accounting system. Reminders go out automatically." }: { invoices: InvoiceRecord[]; fmt: FormatContext; title?: string; description?: string }) {
  const open = invoices.filter((i) => i.status === "SENT" || i.status === "OVERDUE");
  return (
    <Section id="invoices-title" title={title} lede={description} action={<Badge variant={open.some((i) => i.status === "OVERDUE") ? "red" : open.length ? "secondary" : "muted"}>{open.length} open</Badge>}>
      {invoices.length === 0 ? (
        <Empty>No invoices yet. Connect Xero, Square or Stripe and they appear here.</Empty>
      ) : (
        <Panel>
          <ul className="divide-y">
            {invoices.slice(0, 12).map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-4 py-4">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="truncate text-base">
                    {i.number ? `#${i.number}` : "Invoice"} · {i.customerName ?? i.customerEmail ?? "customer"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {i.dueAt ? `${i.status === "PAID" ? "paid" : "due"} ${formatDateTime(i.paidAt ?? i.dueAt, fmt).replace(/,.*$/, "")}` : ""}
                    {i.remindersSent ? ` · ${i.remindersSent} reminder${i.remindersSent === 1 ? "" : "s"} sent` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-base num">{formatMoney(i.status === "PAID" ? i.amountCents : i.amountDueCents, i.currency, fmt.locale)}</span>
                  <StatusBadge status={i.status} />
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </Section>
  );
}

export function AttributionCard({ report, fmt }: { report: AttributionReport; fmt: FormatContext }) {
  const m = (c: number | null) => (c === null ? "–" : formatMoney(c, fmt.currency, fmt.locale));
  return (
    <Section id="attribution-title" title="Where leads come from" lede="Last 30 days: spend, leads and revenue by channel. Cost per lead is spend ÷ leads; revenue per $ is revenue ÷ spend.">
      {report.rows.length === 0 ? (
        <Empty>No leads in this period yet.</Empty>
      ) : (
        <Panel className="overflow-x-auto py-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="py-4 pr-4 font-medium">Channel</th>
                <th scope="col" className="py-4 pr-4 font-medium">Spend</th>
                <th scope="col" className="py-4 pr-4 font-medium">Leads</th>
                <th scope="col" className="py-4 pr-4 font-medium">Booked</th>
                <th scope="col" className="py-4 pr-4 font-medium">Won</th>
                <th scope="col" className="py-4 pr-4 font-medium">Revenue</th>
                <th scope="col" className="py-4 pr-4 font-medium">Cost / lead</th>
                <th scope="col" className="py-4 pr-4 font-medium">Revenue / $</th>
              </tr>
            </thead>
            <tbody className="divide-y border-t">
              {report.rows.map((r) => (
                <tr key={r.key}>
                  <td className="py-3 pr-4">
                    <span className="font-medium capitalize">{r.source.replace(/_/g, " ")}</span>
                    {r.campaign && <span className="text-muted-foreground"> · {r.campaign}</span>}
                  </td>
                  <td className="py-3 pr-4 num">{m(r.spendCents)}</td>
                  <td className="py-3 pr-4 num">{r.leads}</td>
                  <td className="py-3 pr-4 num">{r.booked}</td>
                  <td className="py-3 pr-4 num">{r.won}</td>
                  <td className="py-3 pr-4 num">{m(r.revenueCents)}</td>
                  <td className="py-3 pr-4 num">{m(r.costPerLeadCents)}</td>
                  <td className="py-3 pr-4 num">{r.roas === null ? "–" : `${r.roas.toFixed(1)}×`}</td>
                </tr>
              ))}
              <tr className="font-medium">
                <td className="py-3 pr-4">All channels</td>
                <td className="py-3 pr-4 num">{m(report.totals.spendCents)}</td>
                <td className="py-3 pr-4 num">{report.totals.leads}</td>
                <td className="py-3 pr-4 num">{report.totals.booked}</td>
                <td className="py-3 pr-4 num">{report.totals.won}</td>
                <td className="py-3 pr-4 num">{m(report.totals.revenueCents)}</td>
                <td className="py-3 pr-4 num">{m(report.totals.costPerLeadCents)}</td>
                <td className="py-3 pr-4 num">{report.totals.roas === null ? "–" : `${report.totals.roas.toFixed(1)}×`}</td>
              </tr>
            </tbody>
          </table>
          {report.unattributed > 0 && <p className="border-t py-3 text-sm text-muted-foreground">{report.unattributed} lead{report.unattributed === 1 ? "" : "s"} arrived with no campaign on them (direct, phone or email).</p>}
        </Panel>
      )}
    </Section>
  );
}

export function WebsiteCard({ site, fmt }: { site: SiteSummary; fmt: FormatContext }) {
  const n = (v: number) => v.toLocaleString(fmt.locale);
  return (
    <Section id="website-title" title="Your website, last 7 days" lede="From the site beacon: visits, pages, and how many visitors start and finish a form.">
      {site.days.length === 0 ? (
        <Empty>No website numbers yet. Add the beacon snippet to the site and they appear within a day.</Empty>
      ) : (
        <div className="flex flex-col gap-5">
          <StatStrip columns={4}>
            <Stat label="Visits" value={n(site.sessions7d)} hint={site.sessionsChange !== null ? `${site.sessionsChange > 0 ? "+" : ""}${site.sessionsChange}% vs the week before` : undefined} />
            <Stat label="Page views" value={n(site.pageviews7d)} />
            <Stat label="Forms started" value={n(site.formStarts7d)} />
            <Stat label="Forms sent" value={n(site.formSubmits7d)} hint={site.formConversion !== null ? `${Math.round(site.formConversion * 100)}% of starts` : undefined} tone="green" />
          </StatStrip>
          <Panel className="grid gap-6 py-5 sm:grid-cols-2">
            <div>
              <p className="kicker mb-2 text-xs">Top pages</p>
              <ul className="text-sm">
                {Object.entries(site.topPages).map(([p, v]) => (
                  <li key={p} className="flex justify-between gap-3 py-1">
                    <span className="truncate">{p}</span>
                    <span className="text-muted-foreground num">{n(v)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="kicker mb-2 text-xs">Where visitors came from</p>
              <ul className="text-sm">
                {Object.entries(site.topSources).map(([s, v]) => (
                  <li key={s} className="flex justify-between gap-3 py-1">
                    <span className="truncate capitalize">{s}</span>
                    <span className="text-muted-foreground num">{n(v)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Panel>
        </div>
      )}
    </Section>
  );
}
