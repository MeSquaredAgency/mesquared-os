import { Megaphone, Target, TrendingUp, Wallet } from "lucide-react";
import { Section, Stat, StatStrip } from "@/components/shell/section";
import { COPY } from "@/lib/copy";
import type { MoneySummary } from "@/lib/types";
import { formatMoney, type FormatContext } from "@/lib/utils";

/** Revenue this month against ad spend, and cost per lead. Hidden entirely for users without VIEW_FINANCES. */
export function MoneyPanel({ money, fmt, columns = 4 }: { money: MoneySummary; fmt: FormatContext; columns?: 2 | 4 }) {
  const ratio = money.adSpendMonthCents > 0 ? money.revenueMonthCents / money.adSpendMonthCents : null;
  return (
    <Section id="money-title" title={COPY.money} lede="What came in this month, what the ads cost, and what each lead cost you.">
      <StatStrip columns={columns} label="Money this month">
        <Stat label="Revenue this month" icon={<Wallet />} value={formatMoney(money.revenueMonthCents, fmt.currency, fmt.locale, { whole: true })} tone={money.revenueMonthCents > 0 ? "green" : "neutral"} />
        <Stat label="Ad spend this month" icon={<Megaphone />} value={formatMoney(money.adSpendMonthCents, fmt.currency, fmt.locale, { whole: true })} hint={money.adSpendMonthCents === 0 ? "No ad accounts connected" : undefined} />
        <Stat label="Cost per lead" icon={<Target />} value={money.costPerLeadCents === null ? "–" : formatMoney(money.costPerLeadCents, fmt.currency, fmt.locale, { whole: true })} hint={`${money.leadsMonth} lead${money.leadsMonth === 1 ? "" : "s"} this month`} />
        <Stat label="Revenue per $ of ads" icon={<TrendingUp />} value={ratio === null ? "–" : `${ratio.toFixed(1)}×`} hint={ratio === null ? "Needs ad spend" : "This month"} />
      </StatStrip>
    </Section>
  );
}
