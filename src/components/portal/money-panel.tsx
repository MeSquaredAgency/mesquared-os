import { StatCard } from "@/components/shell/stat-card";
import type { MoneySummary } from "@/lib/types";
import { formatMoney, type FormatContext } from "@/lib/utils";

/** Revenue this month against ad spend, and cost per lead. Hidden entirely for users without VIEW_FINANCES. */
export function MoneyPanel({ money, fmt }: { money: MoneySummary; fmt: FormatContext }) {
  const ratio = money.adSpendMonthCents > 0 ? money.revenueMonthCents / money.adSpendMonthCents : null;
  return (
    <section aria-label="Money this month" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Revenue this month" value={formatMoney(money.revenueMonthCents, fmt.currency, fmt.locale)} tone="green" />
      <StatCard label="Ad spend this month" value={formatMoney(money.adSpendMonthCents, fmt.currency, fmt.locale)} hint={money.adSpendMonthCents === 0 ? "No ad accounts connected" : undefined} />
      <StatCard label="Cost per lead" value={money.costPerLeadCents === null ? "–" : formatMoney(money.costPerLeadCents, fmt.currency, fmt.locale)} hint={`${money.leadsMonth} lead${money.leadsMonth === 1 ? "" : "s"} this month`} />
      <StatCard label="Revenue per $ of ads" value={ratio === null ? "–" : `${ratio.toFixed(1)}×`} hint={ratio === null ? "Needs ad spend" : "This month"} />
    </section>
  );
}
