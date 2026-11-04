import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, MessageSquare, Phone } from "lucide-react";
import { STATUS_LABEL } from "@/components/portal/missed-opportunities";
import { Empty, PageHeader, Section } from "@/components/shell/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getPortalContext } from "@/lib/auth/access";
import { hasPermission } from "@/lib/auth/permissions";
import { MISSED_OPPORTUNITY_LABEL } from "@/lib/copy";
import { repository } from "@/lib/data";
import { moduleOn } from "@/lib/modules/registry";
import { loadOpportunityDetail } from "@/lib/opportunities/detail";
import { cn, formatDateTime, formatMoney } from "@/lib/utils";

export const metadata = { title: "Missed opportunity" };

const OPEN = new Set(["DETECTED", "RECOVERING", "ESCALATED"]);

/** One missed opportunity: who it was, where, what they said, and everything we did about it. */
export default async function OpportunityPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  const { access, user } = await getPortalContext(slug);
  const tenant = access.tenant;
  const fmt = { timezone: tenant.timezone, locale: tenant.locale, currency: tenant.currency };
  const config = await repository.getTenantConfig(tenant.id);
  if (!moduleOn(config.modules, "opportunities")) notFound();
  const detail = await loadOpportunityDetail(tenant.id, id, { onlyAssigneeId: hasPermission(access, "VIEW_ALL_RECORDS") ? null : user.id });
  if (!detail) notFound();

  const { item, person, review, lead, messages, trail } = detail;
  const base = `/app/${slug}`;
  const open = OPEN.has(item.status);
  const status = STATUS_LABEL[item.status] ?? STATUS_LABEL.DETECTED;
  const cents = item.status === "RECOVERED" ? item.recoveredValueCents : item.estimatedValueCents;
  const said = lead?.message?.trim() || null;

  const facts: [string, React.ReactNode][] = [
    ["Who", person ? person.name : "We don’t have a name for them"],
    ...(person?.phone ? [["Phone", <a key="p" href={`tel:${person.phone}`} className="underline-offset-2 hover:underline">{person.phone}</a>] as [string, React.ReactNode]] : []),
    ...(person?.email ? [["Email", <a key="e" href={`mailto:${person.email}`} className="break-all underline-offset-2 hover:underline">{person.email}</a>] as [string, React.ReactNode]] : []),
    ...(detail.where ? [["Where", detail.where] as [string, React.ReactNode]] : []),
    ["Spotted", formatDateTime(item.detectedAt, fmt)],
    ...(item.resolvedAt ? [[item.status === "RECOVERED" ? "Won back" : "Closed", formatDateTime(item.resolvedAt, fmt)] as [string, React.ReactNode]] : []),
    ...(cents > 0 ? [[item.status === "RECOVERED" ? "Worth" : "Estimated value", formatMoney(cents, fmt.currency, fmt.locale, { whole: true })] as [string, React.ReactNode]] : []),
  ];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={MISSED_OPPORTUNITY_LABEL[item.type] ?? item.type}
        title={detail.headline}
        actions={
          <Button asChild variant="outline">
            <Link href={`${base}/opportunities`}>
              <ArrowLeft /> All missed opportunities
            </Link>
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={status.variant}>{status.text}</Badge>
        </div>
      </PageHeader>

      <dl className="surface grid gap-x-8 gap-y-4 p-5 sm:grid-cols-2">
        {facts.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-sm">{value}</dd>
          </div>
        ))}
      </dl>

      {(messages.length > 0 || review || said) && (
        <Section id="said-title" title="What they said">
          {messages.length > 0 ? (
            <ol className="surface flex flex-col gap-3 p-5">
              {messages.map((m, i) => (
                <li key={i} className={cn("flex max-w-[85%] flex-col gap-1", m.from === "us" && "self-end items-end")}>
                  <p className={cn("rounded-lg px-3.5 py-2.5 text-sm whitespace-pre-wrap", m.from === "them" ? "bg-muted" : "bg-blue-soft text-blue-text")}>{m.body || "(no text)"}</p>
                  <p className="text-2xs text-muted-foreground">
                    {m.from === "them" ? (person?.name ?? "Them") : tenant.name} · {formatDateTime(m.at, fmt)}
                  </p>
                </li>
              ))}
            </ol>
          ) : review ? (
            <div className="surface flex flex-col gap-2 p-5">
              {review.rating !== null && <p className="text-sm font-medium">{"★".repeat(review.rating)}{"☆".repeat(Math.max(0, 5 - review.rating))}</p>}
              <blockquote className="border-l-2 border-border-strong pl-3 text-sm whitespace-pre-wrap">{review.body || "(a rating with no written review)"}</blockquote>
              {review.url && (
                <a href={review.url} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 text-sm underline-offset-2 hover:underline">
                  Open the review <ExternalLink className="size-3.5" aria-hidden="true" />
                </a>
              )}
            </div>
          ) : (
            <blockquote className="surface p-5 text-sm whitespace-pre-wrap">{said}</blockquote>
          )}
        </Section>
      )}

      {open && (detail.suggestedAction || detail.awaitingReply || person?.phone) && (
        <Section id="todo-title" title="What to do">
          <div className="surface flex flex-col gap-3 p-5">
            {detail.suggestedAction && <p className="text-sm">{detail.suggestedAction}</p>}
            <div className="flex flex-wrap gap-2">
              {detail.awaitingReply && hasPermission(access, "VIEW_ALL_RECORDS") && (
                <Button asChild size="sm">
                  <Link href={`${base}/content#inbox-title`}>
                    <MessageSquare /> Reply in the inbox
                  </Link>
                </Button>
              )}
              {person?.phone && (
                <Button asChild size="sm" variant="outline">
                  <a href={`tel:${person.phone}`}>
                    <Phone /> Call {person.name}
                  </a>
                </Button>
              )}
            </div>
          </div>
        </Section>
      )}

      <Section id="trail-title" title="What happened" lede="Everything we did about it, oldest first.">
        {trail.length === 0 ? (
          <Empty>Nothing recorded yet.</Empty>
        ) : (
          <ol className="surface divide-y px-5">
            {trail.map((t, i) => (
              <li key={i} className="flex flex-col gap-1 py-3.5">
                <p className="text-sm text-foreground/90">{t.summary}</p>
                <p className="text-xs text-muted-foreground">{formatDateTime(t.at, fmt)}</p>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}
