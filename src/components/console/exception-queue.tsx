"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Empty } from "@/components/shell/section";
import { resolveException } from "@/lib/console/actions";
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
        <p role="status" aria-live="polite" className="rounded-lg bg-muted px-4 py-3 text-sm">
          {notice}
        </p>
      )}
      {visible.length === 0 ? (
        <Empty>Queue is clear.</Empty>
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((item) => {
            const tenant = tenantById.get(item.tenantId);
            return (
              <li key={item.id} className="flex flex-col gap-3 rounded-xl border bg-card px-6 py-5">
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
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
