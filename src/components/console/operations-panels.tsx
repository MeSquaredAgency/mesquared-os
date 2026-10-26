"use client";

import { useState, useTransition } from "react";
import { Check, FileQuestion, MessageSquareReply, UserX, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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

/** Operator controls that drive the automations: appointment outcomes, information requests, review replies. */
export function OperationsPanels({ tenantId, fmt, bookings, requests, reviews, leads }: Props) {
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [newReq, setNewReq] = useState({ leadId: "", description: "", kind: "document", dueInDays: "2" });
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) => start(async () => setNotice((await fn()).message));

  return (
    <div className="flex flex-col gap-4">
      {notice && (
        <p role="status" aria-live="polite" className="rounded-lg bg-muted px-4 py-3 text-sm">
          {notice}
        </p>
      )}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card aria-labelledby="appointments-title">
          <CardHeader>
            <CardTitle id="appointments-title">Appointments</CardTitle>
            <CardDescription>Mark outcomes so follow-ups, review requests and no-show recovery run.</CardDescription>
          </CardHeader>
          <CardContent>
            {bookings.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">No scheduled appointments.</p>
            ) : (
              <ul className="divide-y">
                {bookings.map((b) => (
                  <li key={b.id} className="flex flex-col gap-2 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{b.leadName}</p>
                        <p className="text-xs text-muted-foreground">{b.startsAt ? formatDateTime(b.startsAt, fmt) : "time not set"}</p>
                      </div>
                      <StatusBadge status={b.status} />
                    </div>
                    {b.status === "SCHEDULED" && (
                      <div className="flex gap-2">
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
          </CardContent>
        </Card>

        <Card aria-labelledby="requests-title">
          <CardHeader>
            <CardTitle id="requests-title">Waiting on</CardTitle>
            <CardDescription>Documents and information being chased automatically.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <ul className="divide-y">
              {requests.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm">
                      {r.description} <span className="text-muted-foreground">from {r.who}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.chaseCount} reminder{r.chaseCount === 1 ? "" : "s"}
                      {r.lastChasedAt ? `, last ${timeAgo(r.lastChasedAt)}` : ""}
                      {r.status === "ESCALATED" ? " · needs a call" : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="icon" variant="ghost" className="size-9" aria-label="Received" title="Received" disabled={pending} onClick={() => run(() => closeRequest(tenantId, r.id, true))}>
                      <Check />
                    </Button>
                    <Button size="icon" variant="ghost" className="size-9" aria-label="Stop chasing" title="Stop chasing" disabled={pending} onClick={() => run(() => closeRequest(tenantId, r.id, false))}>
                      <X />
                    </Button>
                  </div>
                </li>
              ))}
              {requests.length === 0 && <li className="py-2 text-sm text-muted-foreground">Nothing being chased.</li>}
            </ul>
            <form
              className="flex flex-col gap-2 border-t pt-3"
              onSubmit={(e) => {
                e.preventDefault();
                const lead = leads.find((l) => l.id === newReq.leadId);
                run(() => openRequest(tenantId, { leadId: lead?.id ?? null, contactId: lead?.contactId ?? null, kind: newReq.kind, description: newReq.description, dueInDays: Number(newReq.dueInDays) || null }));
                setNewReq((n) => ({ ...n, description: "" }));
              }}
            >
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <FileQuestion className="size-3.5" aria-hidden="true" /> Chase something new
              </p>
              <select className="h-10 rounded-lg border border-input bg-card px-3 text-sm" value={newReq.leadId} onChange={(e) => setNewReq((n) => ({ ...n, leadId: e.target.value }))} aria-label="Who">
                <option value="">Who…</option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {[l.firstName, l.lastName].filter(Boolean).join(" ") || l.email || l.phone}
                  </option>
                ))}
              </select>
              <Input placeholder="What are you waiting on? e.g. the signed application" value={newReq.description} onChange={(e) => setNewReq((n) => ({ ...n, description: e.target.value }))} className="h-10 text-sm" />
              <div className="flex items-center gap-2">
                <Input type="number" min={1} max={30} value={newReq.dueInDays} onChange={(e) => setNewReq((n) => ({ ...n, dueInDays: e.target.value }))} className="h-10 w-20 text-sm" aria-label="First reminder in days" />
                <span className="text-xs text-muted-foreground">days until first reminder</span>
                <Button type="submit" size="sm" className="ml-auto" disabled={pending || !newReq.leadId || !newReq.description.trim()}>
                  Open
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card aria-labelledby="reviews-title">
          <CardHeader>
            <CardTitle id="reviews-title">Reviews</CardTitle>
            <CardDescription>Unanswered reviews become missed opportunities after two days.</CardDescription>
          </CardHeader>
          <CardContent>
            {reviews.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">No reviews yet.</p>
            ) : (
              <ul className="divide-y">
                {reviews.map((rv) => (
                  <li key={rv.id} className="flex items-start justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm">
                        {rv.rating ? `${rv.rating}★ ` : ""}
                        {rv.authorName ?? "Anonymous"} <span className="text-xs text-muted-foreground">· {rv.provider} · {timeAgo(rv.receivedAt)}</span>
                      </p>
                      {rv.body && <p className="line-clamp-2 text-xs text-muted-foreground">{rv.body}</p>}
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
