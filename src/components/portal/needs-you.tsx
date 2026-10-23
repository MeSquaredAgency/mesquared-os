import Link from "next/link";
import { Flame, Phone } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { COPY } from "@/lib/copy";
import { leadDisplayName } from "@/lib/leads";
import type { LeadRecord } from "@/lib/types";
import { cn, formatMoney, humanize, timeAgo, type FormatContext } from "@/lib/utils";

interface Props {
  leads: LeadRecord[];
  fmt: FormatContext;
  allHref?: string;
  /** Operators see the classifier reason inline; clients see it on expand. */
  showReasons?: boolean;
}

function Lead({ lead, fmt, showReasons }: { lead: LeadRecord; fmt: FormatContext; showReasons: boolean }) {
  const now = Date.now();
  const overdueResponse = lead.respondBy && !lead.firstResponseAt && lead.respondBy.getTime() < now;
  const overdueBooking = lead.bookBy && !lead.bookedAt && lead.bookBy.getTime() < now;
  const hot = (lead.intentScore ?? 0) >= 85;
  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            {hot && <Flame className="size-3.5 text-red-text" aria-label="Hot lead" />}
            <span className="truncate">{leadDisplayName(lead)}</span>
          </span>
          <p className="line-clamp-2 text-sm text-muted-foreground">{lead.message ?? humanize(lead.source)}</p>
          <p className="text-[11px] text-muted-foreground">
            {humanize(lead.source)} · {timeAgo(lead.createdAt)}
            {lead.valueCents > 0 && <> · worth about {formatMoney(lead.valueCents, fmt.currency, fmt.locale)}</>}
          </p>
          {showReasons && lead.qualificationReason && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Why it’s here</summary>
              <p className="mt-1">{lead.qualificationReason}</p>
            </details>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {overdueResponse ? (
            <Badge variant="red">No reply yet</Badge>
          ) : overdueBooking ? (
            <Badge variant="red">Not booked</Badge>
          ) : lead.status === "BOOKING_SENT" ? (
            <Badge variant="secondary">Link sent</Badge>
          ) : (
            <Badge variant="green">{humanize(lead.status)}</Badge>
          )}
          {lead.phone && (
            <a href={`tel:${lead.phone}`} className={cn("inline-flex items-center gap-1 text-xs text-primary hover:underline")}>
              <Phone className="size-3" aria-hidden="true" /> Call
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

/** New and hot leads waiting on a person: the top of the client portal. */
export function NeedsYou({ leads, fmt, allHref, showReasons = true }: Props) {
  return (
    <Card aria-labelledby="needs-you-title">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle id="needs-you-title">{COPY.needsYou}</CardTitle>
          <CardDescription className="mt-1">New and hot leads waiting for a person.</CardDescription>
        </div>
        <Badge variant={leads.length ? "green" : "muted"}>{leads.length}</Badge>
      </CardHeader>
      <CardContent>
        {leads.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing waiting on you right now.</p>
        ) : (
          <ul className="divide-y">
            {leads.map((l) => (
              <Lead key={l.id} lead={l} fmt={fmt} showReasons={showReasons} />
            ))}
          </ul>
        )}
        {allHref && leads.length > 0 && (
          <Link href={allHref} className="mt-2 inline-block text-xs text-primary hover:underline">
            All leads
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
