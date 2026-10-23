import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { TransactionRecord } from "@/lib/types";
import { cn, formatMoney, humanize, timeAgo } from "@/lib/utils";
import { StatusBadge } from "./status-badge";

export function TransactionStream({ transactions, currency, locale }: { transactions: TransactionRecord[]; currency: string; locale: string }) {
  // Only sum the tenant's own currency; a mixed-currency Square account would otherwise produce a meaningless total.
  const total = transactions.filter((t) => t.status === "COMPLETED" && t.currency === currency).reduce((s, t) => s + t.amountCents, 0);
  const otherCurrencies = new Set(transactions.filter((t) => t.currency !== currency).map((t) => t.currency));

  return (
    <Card aria-labelledby="transactions-title">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle id="transactions-title">Square transactions</CardTitle>
          <CardDescription className="mt-1">Payments synced from this workspace’s Square account.</CardDescription>
        </div>
        <div className="text-right">
          <span className="text-sm font-semibold tabular-nums">{formatMoney(total, currency, locale)}</span>
          <p className="text-[11px] text-muted-foreground">completed, {currency}</p>
          {otherCurrencies.size > 0 && <p className="text-[11px] text-muted-foreground">excludes {[...otherCurrencies].join(", ")}</p>}
        </div>
      </CardHeader>
      <CardContent>
        {transactions.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Connect Square to see payments here.</p>
        ) : (
          <ul className="max-h-[70vh] divide-y overflow-y-auto">
            {transactions.map((t) => {
              const negative = t.amountCents < 0 || t.kind === "REFUND";
              return (
                <li key={t.id} className="flex items-center gap-3 py-3">
                  <span
                    className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", negative ? "bg-red-soft text-red-text" : "bg-green-soft text-green-text")}
                    aria-hidden="true"
                  >
                    {negative ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{t.note ?? humanize(t.kind)}</span>
                    <span className="text-xs text-muted-foreground">
                      {humanize(t.kind)} · {timeAgo(t.occurredAt)}
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className={cn("text-sm font-semibold tabular-nums", negative && "text-red-text")}>{formatMoney(t.amountCents, t.currency, locale)}</span>
                    <StatusBadge status={t.status} className="text-[10px]" />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
