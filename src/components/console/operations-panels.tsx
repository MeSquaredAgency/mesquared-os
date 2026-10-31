"use client";

import { useState, useTransition } from "react";
import { Check, MessageSquareReply, UserX, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import { Meta } from "@/components/shell/section";
import { StatusBadge } from "@/components/shell/status-badge";
import { closeRequest, markReviewReplied, openRequest, setBookingOutcome } from "@/lib/console/actions";
import type { BookingRecord, InformationRequestRecord, LeadRecord, ReviewRecord } from "@/lib/types";
import { formatDateTime, timeAgo, type FormatContext } from "@/lib/utils";

interface Props {
  tenantId: string;
  fmt: Pick<FormatContext, "timezone" | "locale">;
  bookings: (BookingRecord & { leadName: string })[];
  requests: (InformationRequestRecord & { who: string })[];
  reviews: ReviewRecord[];
  leads: LeadRecord[];
}

/** A card's title line: an h3 and the sentence under it. */
function CardHead({ id, title, lede }: { id: string; title: React.ReactNode; lede?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <h3 id={id} className="section-title">
        {title}
      </h3>
      {lede && <p className="mt-0.5 text-sm text-muted-foreground">{lede}</p>}
    </div>
  );
}

/** Operator controls that drive the automations: appointment outcomes, information requests, review replies. */
export function OperationsPanels({ tenantId, fmt, bookings, requests, reviews, leads }: Props) {
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [newReq, setNewReq] = useState({ leadId: "", description: "", kind: "document", dueInDays: "2" });
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) => start(async () => setNotice((await fn()).message));

  return (
    <div className="flex flex-col gap-4">
      {notice && <Notice tone="info">{notice}</Notice>}
      <div className="grid gap-6 xl:grid-cols-3">
        <section aria-labelledby="appointments-title" className="surface flex flex-col gap-3 p-5">
          <CardHead id="appointments-title" title="Appointments" lede="Mark outcomes so follow-ups, review requests and no-show recovery run." />
          {bookings.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">No scheduled appointments.</p>
          ) : (
            <ul className="divide-y">
              {bookings.map((b) => (
                <li key={b.id} className="flex flex-col gap-2 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{b.leadName}</p>
                      <p className="text-xs text-muted-foreground">{b.startsAt ? formatDateTime(b.startsAt, fmt) : "time not set"}</p>
                    </div>
                    <StatusBadge status={b.status} />
                  </div>
                  {b.status === "SCHEDULED" && (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" disabled={pending} onClick={() => run(() => setBookingOutcome(tenantId, b.id, "COMPLETED"))}>
                        <Check /> Attended
                      </Button>
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setBookingOutcome(tenantId, b.id, "NO_SHOW"))}>
                        <UserX /> No-show
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="requests-title" className="surface flex flex-col gap-3 p-5">
          <CardHead id="requests-title" title="Waiting on" lede="Documents and information being chased automatically." />
          <ul className="divide-y">
            {requests.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm">
                    {r.description} <span className="text-muted-foreground">from {r.who}</span>
                  </p>
                  <Meta parts={[`${r.chaseCount} reminder${r.chaseCount === 1 ? "" : "s"}`, r.lastChasedAt ? `last ${timeAgo(r.lastChasedAt)}` : null, r.status === "ESCALATED" ? "needs a call" : null]} />
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="icon-sm" variant="ghost" aria-label="Received" title="Received" disabled={pending} onClick={() => run(() => closeRequest(tenantId, r.id, true))}>
                    <Check />
                  </Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Stop chasing" title="Stop chasing" disabled={pending} onClick={() => run(() => closeRequest(tenantId, r.id, false))}>
                    <X />
                  </Button>
                </div>
              </li>
            ))}
            {requests.length === 0 && <li className="py-3 text-sm text-muted-foreground">Nothing being chased.</li>}
          </ul>
          <form
            className="mt-auto flex flex-col gap-3 border-t pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              const lead = leads.find((l) => l.id === newReq.leadId);
              run(() => openRequest(tenantId, { leadId: lead?.id ?? null, contactId: lead?.contactId ?? null, kind: newReq.kind, description: newReq.description, dueInDays: Number(newReq.dueInDays) || null }));
              setNewReq((n) => ({ ...n, description: "" }));
            }}
          >
            <p className="text-xs font-medium">Chase something new</p>
            <Field label="Who">
              <Select value={newReq.leadId} onChange={(e) => setNewReq((n) => ({ ...n, leadId: e.target.value }))} aria-label="Who">
                <option value="">Who…</option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {[l.firstName, l.lastName].filter(Boolean).join(" ") || l.email || l.phone}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="What are you waiting on?">
              <Input placeholder="e.g. the signed application" value={newReq.description} onChange={(e) => setNewReq((n) => ({ ...n, description: e.target.value }))} />
            </Field>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Days until first reminder">
                <Input type="number" min={1} max={30} value={newReq.dueInDays} onChange={(e) => setNewReq((n) => ({ ...n, dueInDays: e.target.value }))} className="w-24" aria-label="First reminder in days" />
              </Field>
              <Button type="submit" size="sm" className="ml-auto" disabled={pending || !newReq.leadId || !newReq.description.trim()}>
                Open
              </Button>
            </div>
          </form>
        </section>

        <section aria-labelledby="reviews-title" className="surface flex flex-col gap-3 p-5">
          <CardHead id="reviews-title" title="Reviews" lede="Unanswered reviews become missed opportunities after two days." />
          {reviews.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">No reviews yet.</p>
          ) : (
            <ul className="divide-y">
              {reviews.map((rv) => (
                <li key={rv.id} className="flex items-start justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {rv.rating ? `${rv.rating}★ ` : ""}
                      {rv.authorName ?? "Anonymous"}
                    </p>
                    <Meta parts={[rv.provider, timeAgo(rv.receivedAt)]} />
                    {rv.body && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{rv.body}</p>}
                  </div>
                  {rv.repliedAt ? (
                    <Badge variant="green">Replied</Badge>
                  ) : (
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => markReviewReplied(tenantId, rv.id))}>
                      <MessageSquareReply /> Replied
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
