"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { createRealtimeClient, type SealedLiveQuery } from "@neon/realtime/client";
import { RealtimeProvider, useLiveQuery } from "@neon/realtime-react";
import { Badge, Count } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar } from "@/components/shell/avatar";
import { Meta } from "@/components/shell/section";
import { StatusBadge } from "@/components/shell/status-badge";
import { COPY, ticketLabel } from "@/lib/copy";
import { leadDisplayName } from "@/lib/leads";
import type { LiveLeadRow } from "@/lib/realtime/leads";
import { cn, formatDateTime, humanize } from "@/lib/utils";

type LeadView = "all" | "needs_you" | "handled" | "booked" | "won";

const VIEWS: { key: LeadView; label: string; match: (l: LiveLeadRow) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "needs_you", label: COPY.needsYou, match: (l) => l.ticketType === "GREEN" && ["NEW", "QUALIFIED", "BOOKING_SENT"].includes(l.status) },
  { key: "booked", label: "Booked", match: (l) => l.status === "BOOKED" },
  { key: "won", label: "Won", match: (l) => l.status === "WON" },
  { key: "handled", label: COPY.handledForYou, match: (l) => l.ticketType === "RED" },
];

/** Search by name, email, phone, company, message or source; a view narrows by where the lead is up to. */
function matchesSearch(l: LiveLeadRow, q: string): boolean {
  if (!q) return true;
  const hay = [l.firstName, l.lastName, l.email, l.phone, l.company, l.message, humanize(l.source), l.qualificationReason].filter(Boolean).join(" ").toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

/**
 * The lead list with a search box and view pills in front of it. Filtering is
 * local to the browser, so it works the same on the static list and the live
 * one, and never costs a query.
 */
export function FilterableLeadRows({ rows, fmt, stageNames, header }: RowsProps & { header?: React.ReactNode }) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<LeadView>("all");
  const searchRef = useRef<HTMLInputElement>(null);
  // "/" jumps to the search box from anywhere on the page, as in most tools; Escape clears it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.key === "/" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Escape" && target === searchRef.current) {
        setQuery("");
        searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const counts = useMemo(() => Object.fromEntries(VIEWS.map((v) => [v.key, rows.filter(v.match).length])) as Record<LeadView, number>, [rows]);
  const active = VIEWS.find((v) => v.key === view) ?? VIEWS[0];
  const shown = useMemo(() => rows.filter((l) => active.match(l) && matchesSearch(l, query.trim())), [rows, active, query]);
  const filtering = Boolean(query.trim()) || view !== "all";
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-3 border-b py-3 md:flex-row md:items-center md:justify-between">
        <div role="tablist" aria-label="Which leads" className="scrollbar-none -mx-1 flex items-center gap-1 overflow-x-auto px-1">
          {VIEWS.filter((v) => v.key === "all" || counts[v.key] > 0).map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={view === v.key}
              onClick={() => setView(v.key)}
              className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm whitespace-nowrap transition-colors duration-150", view === v.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}
            >
              {v.label}
              <Count n={counts[v.key]} className={cn(view === v.key && "bg-primary-foreground/15 text-primary-foreground")} />
            </button>
          ))}
        </div>
        <label className="relative block md:w-72">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input ref={searchRef} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search leads  ( / )" aria-label="Search leads" aria-keyshortcuts="/" className="h-8 pl-9" />
        </label>
      </div>
      {header}
      {filtering && shown.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No leads match. Try another word, or clear the search.</p> : <LeadRows rows={shown} fmt={fmt} stageNames={stageNames} />}
    </div>
  );
}

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
              <Meta parts={[humanize(l.source), <span key="at" suppressHydrationWarning>{formatDateTime(l.createdAt, fmt)}</span>, l.stageId && stageNames[l.stageId] ? stageNames[l.stageId] : null]} />
              {l.qualificationReason && (
                <details className="text-xs text-muted-foreground">
                  <summary className="w-fit">{l.ticketType === "GREEN" ? "Why this one needs you" : "Why we handled this one"}</summary>
                  <p className="mt-1 max-w-prose">{l.qualificationReason}</p>
                </details>
              )}
            </div>
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
    <FilterableLeadRows
      rows={rows}
      fmt={fmt}
      stageNames={stageNames}
      header={
        <p className="flex items-center gap-2 border-b py-2.5 text-xs text-muted-foreground" role="status" aria-live="polite">
          <span
            className={cn("size-1.5", status === "live" ? "bg-green motion-safe:animate-pulse" : status === "error" ? "bg-red" : "bg-muted-foreground")}
            aria-hidden="true"
          />
          {status === "live" ? "Live" : status === "connecting" ? "Connecting…" : status === "stale" ? "Reconnecting…" : "Live updates stopped"}
          {status === "error" && error ? `: ${error.message}` : null}
        </p>
      }
    />
  );
}
