import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { TransactionRecord } from "@/lib/types";
import { cn, formatMoney, timeAgo } from "@/lib/utils";
import { humanize } from "./platform";

export function TransactionStream({ transactions, currency }: { transactions: TransactionRecord[]; currency: string }) {
  const total = transactions.filter((t) => t.status === "COMPLETED").reduce((s, t) => s + t.amountCents, 0);
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle>Square transactions</CardTitle>
          <CardDescription className="mt-1">Synced from this workspace’s Square account.</CardDescription>
        </div>
        <span className="text-sm font-semibold tabular-nums">{formatMoney(total, currency)}</span>
      </CardHeader>
      <CardContent>
        {transactions.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Connect Square to stream payments here.</p>
        ) : (
          <ul className="divide-y">
            {transactions.map((t) => {
              const negative = t.amountCents < 0 || t.kind === "REFUND";
              return (
                <li key={t.id} className="flex items-center gap-3 py-3">
                  <span className={cn("flex size-8 items-center justify-center rounded-full", negative ? "bg-red-soft text-red" : "bg-green-soft text-green")}>
                    {negative ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{t.note ?? humanize(t.kind)}</span>
                    <span className="text-xs text-muted-foreground">
                      {humanize(t.kind)} · {timeAgo(t.occurredAt)}
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={cn("text-sm font-semibold tabular-nums", negative && "text-red")}>{formatMoney(t.amountCents, t.currency)}</span>
                    <Badge variant={t.status === "COMPLETED" ? "muted" : "outline"} className="text-[10px]">
                      {humanize(t.status)}
                    </Badge>
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
