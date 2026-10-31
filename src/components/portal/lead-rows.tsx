"use client";

import { useCallback, useEffect, useState } from "react";
import { createRealtimeClient, type SealedLiveQuery } from "@neon/realtime/client";
import { RealtimeProvider, useLiveQuery } from "@neon/realtime-react";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/shell/avatar";
import { Meta } from "@/components/shell/section";
import { StatusBadge } from "@/components/shell/status-badge";
import { ticketLabel } from "@/lib/copy";
import { classifierLabel, leadDisplayName } from "@/lib/leads";
import type { LiveLeadRow } from "@/lib/realtime/leads";
import { cn, formatDateTime, humanize } from "@/lib/utils";

interface Fmt {
  timezone: string;
  locale: string;
}

interface RowsProps {
  rows: readonly LiveLeadRow[];
  fmt: Fmt;
  /** Stage id → "Pipeline · Stage". */
  stageNames: Record<string, string>;
}

/** The lead list itself; used for the static render and for live rows alike. */
export function LeadRows({ rows, fmt, stageNames }: RowsProps) {
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">No leads yet.</p>;
  return (
    <ul className="divide-y">
      {rows.map((l) => {
        const name = leadDisplayName(l);
        return (
          <li key={l.id} className="flex items-start gap-3.5 py-4">
            <Avatar name={name} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-base font-medium">{name}</span>
                <StatusBadge status={l.status} />
                <Badge variant={l.ticketType === "GREEN" ? "secondary" : "muted"}>{ticketLabel(l.ticketType)}</Badge>
              </div>
              <p className="line-clamp-2 text-sm text-foreground/85">{l.message ?? "No message"}</p>
              <Meta parts={[humanize(l.source), <span key="at" suppressHydrationWarning>{formatDateTime(l.createdAt, fmt)}</span>, classifierLabel(l.qualifiedBy), l.stageId && stageNames[l.stageId] ? stageNames[l.stageId] : null]} />
              {l.qualificationReason && (
                <details className="text-xs text-muted-foreground">
                  <summary className="w-fit">Why it was classified this way</summary>
                  <p className="mt-1 max-w-prose">{l.qualificationReason}</p>
                </details>
              )}
            </div>
            <span className="shrink-0 text-xs text-muted-foreground num" title="Intent score out of 100">
              Intent {l.intentScore ?? "–"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

interface LiveProps extends RowsProps {
  tenantSlug: string;
  /** The user the page was rendered for; renewals are refused for anyone else. */
  userId: string;
  realtimeUrl: string;
  sealedQuery: SealedLiveQuery<LiveLeadRow>;
}

// Reset by a full page load. Once a renewal answers 401 we stop asking and reload.
let signedOut = false;

/**
 * Lead list kept live by Neon Realtime. The server renders the initial rows
 * and a sealed, tenant-scoped query; the browser subscribes and renews the
 * sealed query through /api/v1/live/leads before it expires.
 */
export function LiveLeads({ realtimeUrl, ...props }: LiveProps) {
  // Created once per mounted page; the server render never subscribes, so it never connects there.
  const [client] = useState(() => createRealtimeClient({ url: realtimeUrl }));
  // The provider does not close the client on unmount; without this every soft navigation leaves a socket open.
  useEffect(() => () => client.close(), [client]);
  return (
    <RealtimeProvider client={client}>
      <LiveLeadRows {...props} />
    </RealtimeProvider>
  );
}

function LiveLeadRows({ tenantSlug, userId, sealedQuery, rows: initialData, fmt, stageNames }: Omit<LiveProps, "realtimeUrl">) {
  const [query] = useState(sealedQuery);
  const refreshQuery = useCallback(async () => {
    if (signedOut) throw new Error("Signed out");
    const res = await fetch("/api/v1/live/leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenant: tenantSlug, userId }),
    });
    if (res.status === 401) {
      signedOut = true;
      window.location.reload();
      throw new Error("Signed out");
    }
    if (!res.ok) throw new Error(`Could not renew the live query (${res.status}).`);
    return (await res.json()) as SealedLiveQuery<LiveLeadRow>;
  }, [tenantSlug, userId]);

  const { data, status, error } = useLiveQuery(query, { refreshQuery, initialData });
  const rows = data ?? initialData;

  return (
    <div className="flex flex-col">
      <p className="flex items-center gap-2 border-b py-2.5 text-xs text-muted-foreground" role="status" aria-live="polite">
        <span
          className={cn("size-1.5", status === "live" ? "bg-green motion-safe:animate-pulse" : status === "error" ? "bg-red" : "bg-muted-foreground")}
          aria-hidden="true"
        />
        {status === "live" ? "Live" : status === "connecting" ? "Connecting…" : status === "stale" ? "Reconnecting…" : "Live updates stopped"}
        {status === "error" && error ? `: ${error.message}` : null}
      </p>
      <LeadRows rows={rows} fmt={fmt} stageNames={stageNames} />
    </div>
  );
}
