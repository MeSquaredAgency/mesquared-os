import Link from "next/link";
import { Phone } from "lucide-react";
import { Avatar } from "@/components/shell/avatar";
import { Empty, Meta, Section } from "@/components/shell/section";
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
    <li className="flex items-start gap-3.5 py-4">
      <Avatar name={name} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-base font-medium">{name}</span>
          {hot && <Badge variant="red">Hot</Badge>}
          {overdueResponse ? <Badge variant="red">No reply yet</Badge> : overdueBooking ? <Badge variant="red">Not booked</Badge> : lead.status === "BOOKING_SENT" ? <Badge variant="secondary">Link sent</Badge> : <Badge variant="green">{humanize(lead.status)}</Badge>}
        </div>
        {lead.message && <p className="line-clamp-2 text-sm text-foreground/85">{lead.message}</p>}
        <Meta parts={[humanize(lead.source), timeAgo(lead.createdAt), lead.valueCents > 0 ? `worth about ${formatMoney(lead.valueCents, fmt.currency, fmt.locale)}` : null]} />
        {showReasons && lead.qualificationReason && (
          <details className="text-xs text-muted-foreground">
            <summary className="w-fit">Why it’s here</summary>
            <p className="mt-1 max-w-prose">{lead.qualificationReason}</p>
          </details>
        )}
      </div>
      {lead.phone && (
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <a href={`tel:${lead.phone}`}>
            <Phone /> Call
          </a>
        </Button>
      )}
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
        allHref ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={allHref}>All leads</Link>
          </Button>
        ) : undefined
      }
    >
      {leads.length === 0 ? (
        <Empty>Every enquiry has been answered. New ones that need a person land here.</Empty>
      ) : (
        <ul className="surface divide-y px-5">
          {leads.map((l) => (
            <Lead key={l.id} lead={l} fmt={fmt} showReasons={showReasons} />
          ))}
        </ul>
      )}
    </Section>
  );
}
