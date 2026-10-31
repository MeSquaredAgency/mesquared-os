"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty } from "@/components/shell/section";
import { closeExceptions, resolveException } from "@/lib/console/actions";
import type { ExceptionRecord, TenantOption } from "@/lib/types";
import { timeAgo } from "@/lib/utils";

interface Props {
  items: ExceptionRecord[];
  tenants: TenantOption[];
}

/** The operator queue: everything automation was not confident about, across the portfolio. */
export function ExceptionQueue({ items, tenants }: Props) {
  const [pending, startTransition] = useTransition();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
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
      setNotice(result.message);
      if (result.ok) hide([item.id]);
    });

  const visible = items.filter((i) => !hidden.has(i.id));
  const chosen = visible.filter((i) => selected.has(i.id));
  const allChosen = visible.length > 0 && chosen.length === visible.length;

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const toggleAll = (on: boolean) => setSelected(on ? new Set(visible.map((i) => i.id)) : new Set());

  const closeChosen = () => {
    if (chosen.length === 0) return;
    const ok = typeof window === "undefined" || window.confirm(`Close ${chosen.length} item${chosen.length === 1 ? "" : "s"} without recovering ${chosen.length === 1 ? "it" : "them"}? Their missed opportunities are written off.`);
    if (!ok) return;
    startTransition(async () => {
      const result = await closeExceptions(chosen.map((i) => ({ tenantId: i.tenantId, exceptionId: i.id })), bulkNote);
      setNotice(result.message);
      hide(result.closedIds);
      if (result.closedIds.length > 0) setBulkNote("");
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {notice && (
        <p role="status" aria-live="polite" className="rounded-lg bg-muted px-4 py-3 text-sm">
          {notice}
        </p>
      )}
      {visible.length === 0 ? (
        <Empty>Queue is clear.</Empty>
      ) : (
        <>
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-xl border bg-card px-6 py-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allChosen}
                ref={(el) => {
                  if (el) el.indeterminate = chosen.length > 0 && !allChosen;
                }}
                onChange={(e) => toggleAll(e.target.checked)}
                disabled={pending}
                className="size-4"
              />
              {chosen.length > 0 ? `${chosen.length} selected` : "Select all"}
            </label>
            {chosen.length > 0 && (
              <>
                <Input placeholder="Why you are closing these (optional)" value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} className="max-w-sm" aria-label="Note for the selected items" />
                <Button variant="outline" onClick={closeChosen} disabled={pending}>
                  <X /> Close selected
                </Button>
                <Button variant="ghost" onClick={() => toggleAll(false)} disabled={pending}>
                  Clear
                </Button>
              </>
            )}
          </div>
          <ul className="flex flex-col gap-3">
            {visible.map((item) => {
              const tenant = tenantById.get(item.tenantId);
              return (
                <li key={item.id} className="flex gap-4 rounded-xl border bg-card px-6 py-5">
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={(e) => toggle(item.id, e.target.checked)}
                    disabled={pending}
                    className="mt-1 size-4 shrink-0"
                    aria-label={`Select: ${item.reason}`}
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      {tenant && (
                        <Link href={`/console/${tenant.slug}`} className="kicker text-sm text-foreground hover:underline">
                          {tenant.name}
                        </Link>
                      )}
                      <span className="text-muted-foreground">· {timeAgo(item.createdAt)}</span>
                      {item.confidence !== null && (
                        <Badge variant="outline" title="Automation confidence">
                          {Math.round(item.confidence * 100)}% confident
                        </Badge>
                      )}
                      {item.escalatedToUserId && <Badge variant="secondary">Escalated to client</Badge>}
                    </div>
                    <div>
                      <p className="text-lg leading-snug">{item.reason}</p>
                      {item.suggestedAction && <p className="mt-1 text-base text-muted-foreground">Suggested: {item.suggestedAction}</p>}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Input placeholder="What you did (optional)" value={notes[item.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [item.id]: e.target.value }))} className="max-w-sm" aria-label="Resolution note" />
                      <Button onClick={() => resolve(item, true)} disabled={pending}>
                        <Check /> Recovered
                      </Button>
                      <Button variant="outline" onClick={() => (typeof window === "undefined" || window.confirm("Close this without recovering it? The missed opportunity is written off.")) && resolve(item, false)} disabled={pending}>
                        <X /> Close
                      </Button>
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
