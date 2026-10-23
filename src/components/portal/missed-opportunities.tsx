import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { COPY, MISSED_OPPORTUNITY_LABEL } from "@/lib/copy";
import type { PortalHome } from "@/lib/types";
import { formatMoney, timeAgo, type FormatContext } from "@/lib/utils";

interface Props {
  missed: PortalHome["missed"];
  fmt: FormatContext;
  allHref?: string;
  limit?: number;
}

const STATUS_LABEL: Record<string, { text: string; variant: "red" | "secondary" | "green" | "muted" }> = {
  DETECTED: { text: "Spotted", variant: "red" },
  RECOVERING: { text: "Recovering", variant: "secondary" },
  ESCALATED: { text: "With your operator", variant: "secondary" },
  RECOVERED: { text: COPY.recovered, variant: "green" },
  EXPIRED: { text: "Closed", variant: "muted" },
};

/** Revenue leaking out, with the money at risk and what has been won back. */
export function MissedOpportunities({ missed, fmt, allHref, limit = 6 }: Props) {
  const shown = missed.open.slice(0, limit);
  return (
    <Card aria-labelledby="missed-title" className="border-t-4 border-t-red">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle id="missed-title">{COPY.missedOpportunities}</CardTitle>
          <CardDescription className="mt-1">Money about to walk out the door, and what we’ve won back this month.</CardDescription>
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold tabular-nums text-red-text">{formatMoney(missed.atRiskCents, fmt.currency, fmt.locale)}</p>
          <p className="text-[11px] text-muted-foreground">{COPY.atRisk}</p>
          <p className="mt-1 text-sm font-semibold tabular-nums text-green-text">{formatMoney(missed.recoveredCents, fmt.currency, fmt.locale)}</p>
          <p className="text-[11px] text-muted-foreground">{COPY.recovered.toLowerCase()} this month</p>
        </div>
      </CardHeader>
      <CardContent>
        {shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing slipping through right now.</p>
        ) : (
          <ul className="divide-y">
            {shown.map((m) => {
              const s = STATUS_LABEL[m.status] ?? STATUS_LABEL.DETECTED;
              return (
                <li key={m.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{MISSED_OPPORTUNITY_LABEL[m.type] ?? m.type}</p>
                    <p className="text-sm">{m.summary}</p>
                    <p className="text-[11px] text-muted-foreground">{timeAgo(m.detectedAt)}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-sm font-semibold tabular-nums">{formatMoney(m.estimatedValueCents, fmt.currency, fmt.locale)}</span>
                    <Badge variant={s.variant}>{s.text}</Badge>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {allHref && missed.open.length > shown.length && (
          <Link href={allHref} className="mt-2 inline-block text-xs text-primary hover:underline">
            +{missed.open.length - shown.length} more
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
