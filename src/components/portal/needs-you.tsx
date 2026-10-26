import Link from "next/link";
import { Phone } from "lucide-react";
import { Avatar } from "@/components/shell/me2-person";
import { Section } from "@/components/shell/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { COPY } from "@/lib/copy";
import { leadDisplayName } from "@/lib/leads";
import type { LeadRecord } from "@/lib/types";
import { formatMoney, humanize, timeAgo, type FormatContext } from "@/lib/utils";

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
  const name = leadDisplayName(lead);
  return (
    <li className="flex items-start gap-4 py-5 first:pt-0 last:pb-0">
      <Avatar name={name} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex items-center gap-2.5 text-base font-medium">
          <span className="truncate">{name}</span>
          {hot && <span className="size-2 shrink-0 bg-brand" role="img" aria-label="Hot lead" title="Hot lead" />}
        </p>
        {lead.message && <p className="line-clamp-2 text-base text-muted-foreground">{lead.message}</p>}
        <p className="text-sm text-muted-foreground">
          {humanize(lead.source)} · {timeAgo(lead.createdAt)}
          {lead.valueCents > 0 && <> · worth about {formatMoney(lead.valueCents, fmt.currency, fmt.locale)}</>}
        </p>
        {showReasons && lead.qualificationReason && (
          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer">Why it’s here</summary>
            <p className="mt-1">{lead.qualificationReason}</p>
          </details>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
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
          <Button asChild variant="outline" size="sm">
            <a href={`tel:${lead.phone}`}>
              <Phone strokeWidth={1.75} /> Call
            </a>
          </Button>
        )}
      </div>
    </li>
  );
}

/** New and hot leads waiting on a person: the top of the client portal. */
export function NeedsYou({ leads, fmt, allHref, showReasons = true }: Props) {
  return (
    <Section
      id="needs-you-title"
      title={COPY.needsYou}
      lede={leads.length === 0 ? "Nothing is waiting on you right now." : `${leads.length === 1 ? "One person is" : `${leads.length} people are`} waiting for a person, not a reply from a machine.`}
      action={
        allHref && leads.length > 0 ? (
          <Button asChild variant="outline" size="sm">
            <Link href={allHref}>All leads</Link>
          </Button>
        ) : undefined
      }
    >
      {leads.length > 0 && (
        <ul className="divide-y rounded-xl border bg-card px-6 py-6">
          {leads.map((l) => (
            <Lead key={l.id} lead={l} fmt={fmt} showReasons={showReasons} />
          ))}
        </ul>
      )}
    </Section>
  );
}
