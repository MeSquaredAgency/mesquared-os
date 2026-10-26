import Link from "next/link";
import { Section } from "@/components/shell/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
  ESCALATED: { text: "With the Me² team", variant: "secondary" },
  RECOVERED: { text: COPY.recovered, variant: "green" },
  EXPIRED: { text: "Closed", variant: "muted" },
};

/** Revenue leaking out, with the money at risk and what has been won back. */
export function MissedOpportunities({ missed, fmt, allHref, limit = 6 }: Props) {
  const shown = missed.open.slice(0, limit);
  const more = missed.open.length - shown.length;
  return (
    <Section
      id="missed-title"
      title={COPY.missedOpportunities}
      lede="Money about to walk out the door, and what we’re doing about it."
      action={
        <dl className="flex gap-8 text-right">
          <div>
            <dd className="display-sm text-red-text">{formatMoney(missed.atRiskCents, fmt.currency, fmt.locale)}</dd>
            <dt className="text-sm text-muted-foreground">{COPY.atRisk}</dt>
          </div>
          <div>
            <dd className="display-sm text-green-text">{formatMoney(missed.recoveredCents, fmt.currency, fmt.locale)}</dd>
            <dt className="text-sm text-muted-foreground">{COPY.recovered.toLowerCase()} this month</dt>
          </div>
        </dl>
      }
    >
      {shown.length === 0 ? (
        <p className="rounded-xl border bg-card px-6 py-8 text-center text-base text-muted-foreground">Nothing slipping through right now.</p>
      ) : (
        <div className="rounded-xl border bg-card px-6 py-2">
          <ul className="divide-y">
            {shown.map((m) => {
              const s = STATUS_LABEL[m.status] ?? STATUS_LABEL.DETECTED;
              return (
                <li key={m.id} className="flex items-start justify-between gap-6 py-5">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <p className="kicker text-xs">{MISSED_OPPORTUNITY_LABEL[m.type] ?? m.type}</p>
                    <p className="text-base">{m.summary}</p>
                    <p className="text-sm text-muted-foreground">{timeAgo(m.detectedAt)}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <span className="text-lg num">{formatMoney(m.estimatedValueCents, fmt.currency, fmt.locale)}</span>
                    <Badge variant={s.variant}>{s.text}</Badge>
                  </div>
                </li>
              );
            })}
          </ul>
          {allHref && more > 0 && (
            <div className="border-t py-4">
              <Button asChild variant="outline" size="sm">
                <Link href={allHref}>{more} more</Link>
              </Button>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
