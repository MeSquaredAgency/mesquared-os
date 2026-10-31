import Link from "next/link";
import { Empty, Section } from "@/components/shell/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { COPY, MISSED_OPPORTUNITY_LABEL } from "@/lib/copy";
import type { PortalHome } from "@/lib/types";
import { cn, formatMoney, timeAgo, type FormatContext } from "@/lib/utils";

interface Props {
  missed: PortalHome["missed"];
  fmt: FormatContext;
  allHref?: string;
  limit?: number;
}

const STATUS_LABEL: Record<string, { text: string; variant: "red" | "secondary" | "green" | "muted" | "amber" }> = {
  DETECTED: { text: "Spotted", variant: "red" },
  RECOVERING: { text: "Recovering", variant: "secondary" },
  ESCALATED: { text: "With the Me² team", variant: "amber" },
  RECOVERED: { text: COPY.recovered, variant: "green" },
  EXPIRED: { text: "Closed", variant: "muted" },
};

/** The two numbers that frame the section: at risk, and won back. */
function Totals({ missed, fmt }: Pick<Props, "missed" | "fmt">) {
  const item = (label: string, cents: number, tone: "red" | "green") => (
    <div className="flex flex-col items-end leading-tight">
      <span className={cn("text-lg font-semibold num", cents > 0 ? (tone === "red" ? "text-red-text" : "text-green-text") : "text-muted-foreground")}>{formatMoney(cents, fmt.currency, fmt.locale)}</span>
      <span className="text-2xs text-muted-foreground">{label}</span>
    </div>
  );
  return (
    <dl className="flex items-end gap-6">
      {item(COPY.atRiskLabel, missed.atRiskCents, "red")}
      {item(COPY.recoveredThisMonth, missed.recoveredCents, "green")}
    </dl>
  );
}

/** Revenue leaking out, with the money at risk and what has been won back. */
export function MissedOpportunities({ missed, fmt, allHref, limit = 6 }: Props) {
  const shown = missed.open.slice(0, limit);
  const more = missed.open.length - shown.length;
  return (
    <Section id="missed-title" title={COPY.missedOpportunities} lede="Money about to walk out the door, and what we’re doing about it." action={<Totals missed={missed} fmt={fmt} />}>
      {shown.length === 0 ? (
        <Empty>Nothing slipping through right now.</Empty>
      ) : (
        <div className="surface px-5">
          <ul className="divide-y">
            {shown.map((m) => {
              const s = STATUS_LABEL[m.status] ?? STATUS_LABEL.DETECTED;
              return (
                <li key={m.id} className="flex items-start justify-between gap-4 py-4">
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="text-sm text-foreground/90">{m.summary}</p>
                    <p className="text-xs text-muted-foreground">
                      {MISSED_OPPORTUNITY_LABEL[m.type] ?? m.type} · {timeAgo(m.detectedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className="text-sm font-medium num">{formatMoney(m.estimatedValueCents, fmt.currency, fmt.locale)}</span>
                    <Badge variant={s.variant}>{s.text}</Badge>
                  </div>
                </li>
              );
            })}
          </ul>
          {allHref && more > 0 && (
            <div className="border-t py-3">
              <Button asChild variant="ghost" size="sm">
                <Link href={allHref}>{more} more</Link>
              </Button>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
