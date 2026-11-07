"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Empty, Meta } from "@/components/shell/section";
import { closeExceptions, resolveException } from "@/lib/console/actions";
import type { AgentApprovalView } from "@/lib/agents/views";
import type { ExceptionRecord, TenantOption } from "@/lib/types";
import { formatMoney, timeAgo } from "@/lib/utils";
import { AgentApprovalCard } from "./agent-approval-card";

/** The money behind a queue item: the open missed opportunity it was raised for. */
export interface QueueStake {
  valueCents: number;
  label: string;
  currency: string;
  locale: string;
}

interface Props {
  items: ExceptionRecord[];
  tenants: TenantOption[];
  /** Missed opportunity id → what it is worth; items without one are automation failures. */
  stakes?: Record<string, QueueStake>;
  /** Exception id → the action an agent is waiting on. Only a decision closes these, so they get their own card. */
  approvals?: Record<string, AgentApprovalView>;
}

const CHECKBOX = "size-4 shrink-0 accent-[var(--navy)]";

/** The operator queue: everything automation was not confident about, across the portfolio. */
export function ExceptionQueue({ items, tenants, stakes = {}, approvals = {} }: Props) {
  const [pending, startTransition] = useTransition();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkNote, setBulkNote] = useState("");
  const tenantById = new Map(tenants.map((t) => [t.id, t]));

  const hide = (ids: string[]) => {
    setHidden((prev) => new Set([...prev, ...ids]));
    setSelected((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
  };

  const resolve = (item: ExceptionRecord, recovered: boolean) =>
    startTransition(async () => {
      const result = await resolveException(item.tenantId, item.id, notes[item.id] ?? "", recovered);
      setNotice({ tone: result.ok ? "ok" : "error", text: result.message });
      if (result.ok) hide([item.id]);
    });

  const visible = items.filter((i) => !hidden.has(i.id));
  // An agent's approval is never closed in bulk: it needs its own yes or no.
  const selectable = visible.filter((i) => !i.agentToolCallId);
  const chosen = selectable.filter((i) => selected.has(i.id));
  const allChosen = selectable.length > 0 && chosen.length === selectable.length;

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const toggleAll = (on: boolean) => setSelected(on ? new Set(selectable.map((i) => i.id)) : new Set());

  const closeChosen = () => {
    if (chosen.length === 0) return;
    const ok = typeof window === "undefined" || window.confirm(`Close ${chosen.length} item${chosen.length === 1 ? "" : "s"} without recovering ${chosen.length === 1 ? "it" : "them"}? Their missed opportunities are written off.`);
    if (!ok) return;
    startTransition(async () => {
      const result = await closeExceptions(chosen.map((i) => ({ tenantId: i.tenantId, exceptionId: i.id })), bulkNote);
      setNotice({ tone: result.ok ? "ok" : "error", text: result.message });
      hide(result.closedIds);
      if (result.closedIds.length > 0) setBulkNote("");
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {visible.length === 0 ? (
        <Empty>The queue is clear. New exceptions appear here as automations hit something they are not sure about.</Empty>
      ) : (
        <>
          {/* Selection bar: pick several, close them with one note. */}
          {selectable.length > 0 && (
            <div className="surface sticky top-14 z-10 flex flex-wrap items-center gap-3 px-4 py-2.5 md:top-0">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={allChosen}
                  ref={(el) => {
                    if (el) el.indeterminate = chosen.length > 0 && !allChosen;
                  }}
                  onChange={(e) => toggleAll(e.target.checked)}
                  disabled={pending}
                  className={CHECKBOX}
                />
                {chosen.length > 0 ? <span className="font-medium">{chosen.length} selected</span> : "Select all"}
              </label>
              {chosen.length > 0 && (
                <div className="flex flex-1 flex-wrap items-center gap-2 sm:justify-end">
                  <Input placeholder="Why you are closing these (optional)" value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} className="h-8 sm:w-72" aria-label="Note for the selected items" />
                  <Button variant="outline" size="sm" onClick={closeChosen} disabled={pending}>
                    <X /> Close selected
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => toggleAll(false)} disabled={pending}>
                    Clear
                  </Button>
                </div>
              )}
            </div>
          )}

          <ul className="flex flex-col gap-3">
            {visible.map((item) => {
              const tenant = tenantById.get(item.tenantId);
              if (item.agentToolCallId) {
                const approval = approvals[item.id];
                return approval ? (
                  <AgentApprovalCard
                    key={item.id}
                    item={item}
                    view={approval}
                    tenant={tenant}
                    disabled={pending}
                    onDone={(result) => {
                      setNotice({ tone: result.ok ? "ok" : "error", text: result.message });
                      if (result.ok && !result.stillOpen) hide([item.id]);
                    }}
                  />
                ) : (
                  <li key={item.id} className="surface p-5 text-sm text-muted-foreground">
                    {item.reason} Someone has already decided this; refresh to clear it.
                  </li>
                );
              }
              const stake = item.missedOpportunityId ? stakes[item.missedOpportunityId] : undefined;
              return (
                <li key={item.id} className="surface flex gap-4 p-5">
                  <input type="checkbox" checked={selected.has(item.id)} onChange={(e) => toggle(item.id, e.target.checked)} disabled={pending} className={`${CHECKBOX} mt-1`} aria-label={`Select: ${item.reason}`} />
                  <div className="flex min-w-0 flex-1 flex-col gap-4 lg:flex-row lg:items-start lg:gap-8">
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <Meta
                        parts={[
                          tenant ? (
                            <Link href={`/console/${tenant.slug}`} className="font-medium text-foreground hover:underline">
                              {tenant.name}
                            </Link>
                          ) : null,
                          timeAgo(item.createdAt),
                          stake ? stake.label : item.missedOpportunityId ? null : "Automation failure",
                          stake && stake.valueCents > 0 ? (
                            <span key="stake" className="font-medium text-red-text num">
                              {formatMoney(stake.valueCents, stake.currency, stake.locale)} at risk
                            </span>
                          ) : null,
                          item.confidence !== null ? `${Math.round(item.confidence * 100)}% confident` : null,
                        ]}
                      />
                      <p className="text-md font-medium">{item.reason}</p>
                      {item.suggestedAction && (
                        <p className="text-sm text-muted-foreground">
                          <span className="font-medium text-foreground">Suggested:</span> {item.suggestedAction}
                        </p>
                      )}
                      {item.escalatedToUserId && <Badge variant="secondary">Escalated to the client</Badge>}
                      {item.agentRunId && tenant && (
                        <Link href={`/console/${tenant.slug}/agents/runs/${item.agentRunId}`} className="w-fit text-sm underline underline-offset-4 hover:text-foreground">
                          See what the agent did
                        </Link>
                      )}
                    </div>
                    <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto lg:flex-col lg:items-stretch">
                      <Input placeholder="What you did (optional)" value={notes[item.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [item.id]: e.target.value }))} className="sm:w-64" aria-label="Resolution note" />
                      <div className="flex gap-2">
                        <Button onClick={() => resolve(item, true)} disabled={pending} className="flex-1">
                          <Check /> Recovered
                        </Button>
                        <Button variant="outline" onClick={() => (typeof window === "undefined" || window.confirm("Close this without recovering it? The missed opportunity is written off.")) && resolve(item, false)} disabled={pending}>
                          <X /> Close
                        </Button>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
