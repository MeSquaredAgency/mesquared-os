"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resolveException } from "@/lib/console/actions";
import type { ExceptionRecord, TenantOption } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";

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
  const tenantById = new Map(tenants.map((t) => [t.id, t]));

  const resolve = (item: ExceptionRecord, recovered: boolean) =>
    startTransition(async () => {
      const result = await resolveException(item.tenantId, item.id, notes[item.id] ?? "", recovered);
      setNotice(result.message);
      if (result.ok) setHidden((prev) => new Set(prev).add(item.id));
    });

  const visible = items.filter((i) => !hidden.has(i.id));

  return (
    <div className="flex flex-col gap-3">
      {notice && (
        <p role="status" aria-live="polite" className="rounded-md bg-muted px-3 py-2 text-sm">
          {notice}
        </p>
      )}
      {visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Queue is clear.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((item) => {
            const tenant = tenantById.get(item.tenantId);
            return (
              <li key={item.id} className="rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  {tenant && (
                    <Link href={`/console/${tenant.slug}`} className="text-xs font-medium hover:underline">
                      {tenant.name}
                    </Link>
                  )}
                  <span className="text-xs text-muted-foreground">· {timeAgo(item.createdAt)}</span>
                  {item.confidence !== null && (
                    <Badge variant="outline" title="Automation confidence">
                      {Math.round(item.confidence * 100)}% confident
                    </Badge>
                  )}
                  {item.escalatedToUserId && <Badge variant="secondary">Escalated to client</Badge>}
                </div>
                <p className="mt-2 text-sm font-medium">{item.reason}</p>
                {item.suggestedAction && <p className="mt-1 text-sm text-muted-foreground">Suggested: {item.suggestedAction}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Input
                    placeholder="What you did (optional)"
                    value={notes[item.id] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [item.id]: e.target.value }))}
                    className={cn("h-8 max-w-sm text-xs")}
                    aria-label="Resolution note"
                  />
                  <Button size="sm" variant="green" onClick={() => resolve(item, true)} disabled={pending}>
                    <Check /> Recovered
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => (typeof window === "undefined" || window.confirm("Close this without recovering it? The missed opportunity is written off.")) && resolve(item, false)} disabled={pending}>
                    <X /> Close
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
