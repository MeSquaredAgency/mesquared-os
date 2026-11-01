import { Section, Stat, StatStrip } from "@/components/shell/section";
import { COPY } from "@/lib/copy";
import type { MoneySummary } from "@/lib/types";
import { formatMoney, type FormatContext } from "@/lib/utils";

/** Revenue this month against ad spend, and cost per lead. Hidden entirely for users without VIEW_FINANCES. */
export function MoneyPanel({ money, fmt }: { money: MoneySummary; fmt: FormatContext }) {
  const ratio = money.adSpendMonthCents > 0 ? money.revenueMonthCents / money.adSpendMonthCents : null;
  return (
    <Section id="money-title" title={COPY.money} lede="What came in this month, what the ads cost, and what each lead cost you.">
      <StatStrip columns={4} label="Money this month">
        <Stat label="Revenue this month" value={formatMoney(money.revenueMonthCents, fmt.currency, fmt.locale, { whole: true })} tone={money.revenueMonthCents > 0 ? "green" : "neutral"} />
        <Stat label="Ad spend this month" value={formatMoney(money.adSpendMonthCents, fmt.currency, fmt.locale, { whole: true })} hint={money.adSpendMonthCents === 0 ? "No ad accounts connected" : undefined} />
        <Stat label="Cost per lead" value={money.costPerLeadCents === null ? "–" : formatMoney(money.costPerLeadCents, fmt.currency, fmt.locale, { whole: true })} hint={`${money.leadsMonth} lead${money.leadsMonth === 1 ? "" : "s"} this month`} />
        <Stat label="Revenue per $ of ads" value={ratio === null ? "–" : `${ratio.toFixed(1)}×`} hint={ratio === null ? "Needs ad spend" : "This month"} />
      </StatStrip>
    </Section>
  );
}
