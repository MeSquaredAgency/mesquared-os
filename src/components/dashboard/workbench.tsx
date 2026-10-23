"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import { CalendarClock, Check, Link2, RotateCcw, Send, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { Workbench as WorkbenchData } from "@/lib/data";
import { decideAsset, submitDraft } from "@/lib/marketing/actions";
import { SOCIAL_PLATFORMS, type ContentAssetRecord, type ContentStatus, type SocialPlatform } from "@/lib/types";
import { cn, formatDateTime, formatLocalInput, humanize, type FormatContext } from "@/lib/utils";
import { PLATFORM_LABEL, PLATFORM_LIMIT } from "./platform";
import { StatusBadge } from "./status-badge";

type Fmt = Pick<FormatContext, "timezone" | "locale">;

interface Props {
  data: WorkbenchData;
  tenantName: string;
  fmt: Fmt;
  canDraft: boolean;
  canApprove: boolean;
}

/**
 * Multi-channel creation + approval workbench.
 *
 * Drafts and decisions go through server actions and persist per tenant;
 * the review list updates optimistically and is reconciled when the page
 * revalidates. Per-channel AI variants arrive with the content engine.
 */
export function Workbench({ data, tenantName, fmt, canDraft, canApprove }: Props) {
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  // Compose state
  const [caption, setCaption] = useState("");
  const [tags, setTags] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [selected, setSelected] = useState<Set<SocialPlatform>>(() => new Set(data.connectedPlatforms));

  // Review state: props are the source of truth; optimistic overlay while an action is in flight.
  const [assets, applyDecision] = useOptimistic(data.assets, (current: ContentAssetRecord[], change: { id: string; status: ContentStatus }) =>
    current.map((a) => (a.id === change.id ? { ...a, status: change.status } : a)),
  );

  const overLimit = useMemo(() => SOCIAL_PLATFORMS.filter((p) => selected.has(p) && caption.length > PLATFORM_LIMIT[p]), [caption, selected]);
  const pendingReview = assets.filter((a) => a.status === "IN_REVIEW" || a.status === "DRAFT");
  const decided = assets.filter((a) => a.status !== "IN_REVIEW" && a.status !== "DRAFT");

  const toggle = (p: SocialPlatform) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const sendToReview = () => {
    const payload = {
      caption,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      platforms: [...selected],
      scheduledForLocal: scheduledFor || null,
    };
    startTransition(async () => {
      const result = await submitDraft(payload);
      setNotice({ tone: result.ok ? "ok" : "error", text: result.message });
      if (result.ok) {
        setCaption("");
        setTags("");
        setScheduledFor("");
      }
    });
  };

  const decide = (id: string, status: ContentStatus) => {
    startTransition(async () => {
      applyDecision({ id, status });
      const result = await decideAsset(id, status);
      setNotice({ tone: result.ok ? "ok" : "error", text: result.message });
    });
  };

  return (
    <Tabs defaultValue="compose" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="compose">Compose</TabsTrigger>
          <TabsTrigger value="review">
            Review
            {pendingReview.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5" aria-label={`${pendingReview.length} awaiting approval`}>
                {pendingReview.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
        </TabsList>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Link2 className="size-3.5" aria-hidden="true" />
          {data.connectedPlatforms.length} of 5 channels connected for {tenantName}
        </div>
      </div>

      {notice && (
        <p role="status" aria-live="polite" className={cn("rounded-md px-3 py-2 text-sm", notice.tone === "ok" ? "bg-green-soft text-green-text" : "bg-red-soft text-red-text")}>
          {notice.text}
        </p>
      )}

      <TabsContent value="compose">
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <Card aria-labelledby="compose-title">
            <CardHeader>
              <CardTitle id="compose-title">Draft once, post everywhere</CardTitle>
              <CardDescription>One draft becomes a review item per channel. Edit per-channel copy in Review.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                Post text
                <Textarea
                  placeholder="What’s the story? Paste a client quote, a result, or a hook…"
                  value={caption}
                  onChange={(e) => {
                    setCaption(e.target.value);
                    if (notice) setNotice(null);
                  }}
                  className="min-h-40 text-sm text-foreground"
                  disabled={!canDraft}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                  Tags (comma separated)
                  <Input placeholder="implants, patientstory" value={tags} onChange={(e) => setTags(e.target.value)} disabled={!canDraft} />
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                  Schedule for ({fmt.timezone})
                  <Input type="datetime-local" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} disabled={!canDraft} />
                </label>
              </div>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Channels">
                {SOCIAL_PLATFORMS.map((p) => {
                  const connected = data.connectedPlatforms.includes(p);
                  const on = selected.has(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => connected && toggle(p)}
                      disabled={!connected || !canDraft}
                      aria-pressed={on}
                      className={cn(
                        "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                        on ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-accent",
                        !connected && "cursor-not-allowed opacity-40",
                      )}
                    >
                      {on && <Check className="size-3" aria-hidden="true" />}
                      {PLATFORM_LABEL[p]}
                      {!connected && <span className="sr-only"> (not connected)</span>}
                    </button>
                  );
                })}
              </div>
              {overLimit.length > 0 && (
                <p className="text-xs text-red-text">
                  Caption exceeds the limit for {overLimit.map((p) => PLATFORM_LABEL[p]).join(", ")}. Shorten it, or edit the per-channel copy in Review.
                </p>
              )}
              {!canDraft && <p className="text-xs text-muted-foreground">Your role in this workspace is view-only.</p>}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <span className="text-xs text-muted-foreground">
                  {caption.length} characters · {selected.size} channel{selected.size === 1 ? "" : "s"}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" disabled title="Per-channel AI variants arrive with the content engine">
                    <Sparkles /> Generate variants <span className="text-[10px] font-normal text-muted-foreground">soon</span>
                  </Button>
                  <Button disabled={!canDraft || !caption.trim() || selected.size === 0 || pending} onClick={sendToReview}>
                    <Send /> {pending ? "Sending…" : "Send to review"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card aria-labelledby="preview-title">
            <CardHeader>
              <CardTitle id="preview-title" className="text-sm">
                Preview
              </CardTitle>
              <CardDescription>How the first selected channel will see it.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border bg-muted/40 p-4 text-sm">
                <div className="mb-2 flex items-center gap-2">
                  <span className="size-7 rounded-full bg-primary/80" aria-hidden="true" />
                  <div className="flex flex-col leading-tight">
                    <span className="text-xs font-semibold">{tenantName}</span>
                    <span className="text-[10px] text-muted-foreground">{scheduledFor ? formatLocalInput(scheduledFor, fmt.locale) : "Now"}</span>
                  </div>
                </div>
                <p className="whitespace-pre-wrap text-sm">{caption || <span className="text-muted-foreground">Your post will appear here.</span>}</p>
                {tags && (
                  <p className="mt-2 text-xs text-primary">
                    {tags
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean)
                      .map((t) => `#${t}`)
                      .join(" ")}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="review">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card aria-labelledby="awaiting-title">
            <CardHeader>
              <CardTitle id="awaiting-title">Awaiting approval</CardTitle>
              <CardDescription>Approve to queue for scheduling. Reject to send it back.</CardDescription>
            </CardHeader>
            <CardContent>
              {pendingReview.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Inbox zero. Nothing waiting on you.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {pendingReview.map((a) => (
                    <li key={a.id} className="rounded-lg border p-3">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <StatusBadge status={a.status} />
                        <Badge variant="outline">{humanize(a.kind)}</Badge>
                        {a.targetPlatform && <Badge variant="muted">{PLATFORM_LABEL[a.targetPlatform]}</Badge>}
                      </div>
                      <p className="text-sm font-medium">{a.title}</p>
                      <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{a.body}</p>
                      {canApprove ? (
                        <div className="mt-3 flex gap-2">
                          <Button size="sm" variant="green" onClick={() => decide(a.id, "APPROVED")} disabled={pending}>
                            <Check /> Approve
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => decide(a.id, "REJECTED")} disabled={pending}>
                            <X /> Reject
                          </Button>
                        </div>
                      ) : (
                        <p className="mt-3 text-xs text-muted-foreground">An operator or admin approves this.</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card aria-labelledby="decided-title">
            <CardHeader>
              <CardTitle id="decided-title">Decided</CardTitle>
              <CardDescription>Approved drafts move to scheduling; rejected ones go back to the engine.</CardDescription>
            </CardHeader>
            <CardContent>
              {decided.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No decisions yet.</p>
              ) : (
                <ul className="divide-y">
                  {decided.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm">{a.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {humanize(a.kind)}
                          {a.targetPlatform ? ` · ${PLATFORM_LABEL[a.targetPlatform]}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge status={a.status} />
                        {canApprove && (a.status === "APPROVED" || a.status === "REJECTED") && (
                          <Button size="icon" variant="ghost" className="size-7" onClick={() => decide(a.id, "IN_REVIEW")} aria-label="Move back to review" title="Move back to review" disabled={pending}>
                            <RotateCcw />
                          </Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="scheduled">
        <Card aria-labelledby="queue-title">
          <CardHeader>
            <CardTitle id="queue-title">Queue</CardTitle>
            <CardDescription>Posts grouped by batch across channels.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.posts.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nothing scheduled.</p>
            ) : (
              <ul className="divide-y">
                {data.posts.map((p) => (
                  <li key={p.id} className="grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 py-3 sm:flex sm:items-center">
                    <Badge variant="muted" className="w-20 justify-center">
                      {PLATFORM_LABEL[p.platform]}
                    </Badge>
                    <p className="min-w-0 truncate text-sm sm:flex-1">{p.caption}</p>
                    <span className="col-start-2 inline-flex items-center gap-1 text-xs text-muted-foreground sm:col-auto sm:shrink-0">
                      <CalendarClock className="size-3.5" aria-hidden="true" />
                      {p.scheduledFor ? formatDateTime(p.scheduledFor, fmt) : "unscheduled"}
                    </span>
                    <StatusBadge status={p.status} className="col-start-2 sm:col-auto" />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
