import Link from "next/link";
import { Phone } from "lucide-react";
import { Avatar } from "@/components/shell/avatar";
import { LeadHandledButton } from "@/components/portal/lead-handled-button";
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
  /** When set, each lead gets an "I've called them" action that settles it. */
  tenantSlug?: string;
  /** Lead id → the newest call brief, shown open above the call button. */
  briefs?: Record<string, string>;
}

function Lead({ lead, fmt, showReasons, tenantSlug, brief }: { lead: LeadRecord; fmt: FormatContext; showReasons: boolean; tenantSlug?: string; brief?: string }) {
  const now = Date.now();
  const overdueResponse = lead.respondBy && !lead.firstResponseAt && lead.respondBy.getTime() < now;
  const overdueBooking = lead.bookBy && !lead.bookedAt && lead.bookBy.getTime() < now;
  const hot = (lead.intentScore ?? 0) >= 85;
  const name = leadDisplayName(lead);
  return (
    <li className="list-row flex flex-wrap items-start gap-x-3.5 gap-y-3 py-4 sm:flex-nowrap">
      <Avatar name={name} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-md font-semibold tracking-[-0.01em]">{name}</span>
          {hot && <Badge variant="red">Hot</Badge>}
          {overdueResponse ? <Badge variant="red">No reply yet</Badge> : overdueBooking ? <Badge variant="red">Not booked</Badge> : lead.status === "BOOKING_SENT" ? <Badge variant="secondary">Link sent</Badge> : <Badge variant="green">{humanize(lead.status)}</Badge>}
        </div>
        {lead.message && <p className="line-clamp-2 text-sm text-foreground/85">{lead.message}</p>}
        <Meta parts={[humanize(lead.source), timeAgo(lead.createdAt), lead.valueCents > 0 ? `worth about ${formatMoney(lead.valueCents, fmt.currency, fmt.locale)}` : null]} />
        {brief && (
          <details open className="mt-1 rounded-md border bg-muted/40 px-3 py-2 text-sm">
            <summary className="w-fit cursor-pointer text-xs font-medium text-muted-foreground">Before you call</summary>
            <p className="mt-1.5 max-w-prose whitespace-pre-wrap">{brief}</p>
          </details>
        )}
        {showReasons && lead.qualificationReason && (
          <details className="text-xs text-muted-foreground">
            <summary className="w-fit">Why this one needs you</summary>
            <p className="mt-1 max-w-prose">{lead.qualificationReason}</p>
          </details>
        )}
      </div>
      <div className="flex w-full shrink-0 items-center gap-2 pl-[3.125rem] sm:w-auto sm:pl-0">
        {lead.phone && (
          <Button asChild variant="outline" size="sm">
            <a href={`tel:${lead.phone}`}>
              <Phone /> Call
            </a>
          </Button>
        )}
        {tenantSlug && <LeadHandledButton tenantSlug={tenantSlug} leadId={lead.id} />}
      </div>
    </li>
  );
}

/** New and hot leads waiting on a person: the top of the client portal. */
export function NeedsYou({ leads, fmt, allHref, showReasons = true, tenantSlug, briefs = {} }: Props) {
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
        <ul className="surface rise-stagger divide-y px-5">
          {leads.map((l) => (
            <Lead key={l.id} lead={l} fmt={fmt} showReasons={showReasons} tenantSlug={tenantSlug} brief={briefs[l.id]} />
          ))}
        </ul>
      )}
    </Section>
  );
}
