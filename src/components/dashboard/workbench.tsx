"use client";

import { useMemo, useState } from "react";
import { CalendarClock, Check, Link2, Send, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { Workbench as WorkbenchData } from "@/lib/data";
import { SOCIAL_PLATFORMS, type ContentAssetRecord, type ContentStatus, type SocialPlatform } from "@/lib/types";
import { cn } from "@/lib/utils";
import { humanize, PLATFORM_LABEL, PLATFORM_LIMIT } from "./platform";

const STATUS_VARIANT: Record<ContentStatus, "green" | "red" | "secondary" | "muted" | "outline"> = {
  DRAFT: "outline",
  IN_REVIEW: "secondary",
  APPROVED: "green",
  REJECTED: "red",
  SCHEDULED: "muted",
  PUBLISHED: "muted",
};

/**
 * Multi-channel creation + approval workbench.
 *
 * Draft once, tag, pick channels and a time; review generated drafts and
 * approve/reject them. State is local for now — the persistence actions land
 * with the social engine (SocialPost / ContentAsset writes).
 */
export function Workbench({ data, tenantName }: { data: WorkbenchData; tenantName: string }) {
  const [caption, setCaption] = useState("");
  const [tags, setTags] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [selected, setSelected] = useState<Set<SocialPlatform>>(() => new Set(data.connectedPlatforms));
  const [assets, setAssets] = useState<ContentAssetRecord[]>(data.assets);
  const [submitted, setSubmitted] = useState<string | null>(null);

  const overLimit = useMemo(
    () => SOCIAL_PLATFORMS.filter((p) => selected.has(p) && caption.length > PLATFORM_LIMIT[p]),
    [caption, selected],
  );

  const toggle = (p: SocialPlatform) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const setStatus = (id: string, status: ContentStatus) =>
    setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));

  const pending = assets.filter((a) => a.status === "IN_REVIEW" || a.status === "DRAFT");
  const decided = assets.filter((a) => a.status !== "IN_REVIEW" && a.status !== "DRAFT");

  return (
    <Tabs defaultValue="compose" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="compose">Compose</TabsTrigger>
          <TabsTrigger value="review">
            Review
            {pending.length > 0 && <Badge variant="secondary" className="ml-1 h-5 px-1.5">{pending.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="scheduled">Scheduled</TabsTrigger>
        </TabsList>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Link2 className="size-3.5" />
          {data.connectedPlatforms.length} of 5 channels connected for {tenantName}
        </div>
      </div>

      <TabsContent value="compose">
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader>
              <CardTitle>Draft once, post everywhere</CardTitle>
              <CardDescription>One asset becomes a tailored post per channel. Edit per-channel copy in Review.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Textarea
                placeholder="What’s the story? Paste a client quote, a result, or a hook…"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                className="min-h-40"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                  Tags
                  <Input placeholder="implants, patientstory" value={tags} onChange={(e) => setTags(e.target.value)} />
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                  Schedule for
                  <Input type="datetime-local" value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                {SOCIAL_PLATFORMS.map((p) => {
                  const connected = data.connectedPlatforms.includes(p);
                  const on = selected.has(p);
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => connected && toggle(p)}
                      disabled={!connected}
                      className={cn(
                        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors",
                        on ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-accent",
                        !connected && "cursor-not-allowed opacity-40",
                      )}
                      title={connected ? undefined : "Not connected for this workspace"}
                    >
                      {on && <Check className="size-3" />}
                      {PLATFORM_LABEL[p]}
                    </button>
                  );
                })}
              </div>
              {overLimit.length > 0 && (
                <p className="text-xs text-red">
                  Caption exceeds the limit for {overLimit.map((p) => PLATFORM_LABEL[p]).join(", ")}. The AI engine will shorten it per channel.
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <span className="text-xs text-muted-foreground">
                  {caption.length} characters · {selected.size} channel{selected.size === 1 ? "" : "s"}
                </span>
                <div className="flex gap-2">
                  <Button variant="outline" disabled={!caption.trim()}>
                    <Sparkles /> Generate variants
                  </Button>
                  <Button
                    disabled={!caption.trim() || selected.size === 0}
                    onClick={() => setSubmitted(`Queued ${selected.size} draft${selected.size === 1 ? "" : "s"} for review.`)}
                  >
                    <Send /> Send to review
                  </Button>
                </div>
              </div>
              {submitted && <p className="text-xs text-green">{submitted}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Preview</CardTitle>
              <CardDescription>How the first selected channel will see it.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border bg-muted/40 p-4 text-sm">
                <div className="mb-2 flex items-center gap-2">
                  <span className="size-7 rounded-full bg-primary/80" />
                  <div className="flex flex-col leading-tight">
                    <span className="text-xs font-semibold">{tenantName}</span>
                    <span className="text-[10px] text-muted-foreground">{scheduledFor ? new Date(scheduledFor).toLocaleString() : "Now"}</span>
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
          <Card>
            <CardHeader>
              <CardTitle>Awaiting approval</CardTitle>
              <CardDescription>AI-generated drafts. Approve to schedule, reject to regenerate.</CardDescription>
            </CardHeader>
            <CardContent>
              {pending.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Inbox zero. Nothing waiting on you.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {pending.map((a) => (
                    <li key={a.id} className="rounded-lg border p-3">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Badge variant={STATUS_VARIANT[a.status]}>{humanize(a.status)}</Badge>
                        <Badge variant="outline">{humanize(a.kind)}</Badge>
                        {a.targetPlatform && <Badge variant="muted">{PLATFORM_LABEL[a.targetPlatform]}</Badge>}
                      </div>
                      <p className="text-sm font-medium">{a.title}</p>
                      <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{a.body}</p>
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" variant="green" onClick={() => setStatus(a.id, "APPROVED")}>
                          <Check /> Approve
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setStatus(a.id, "REJECTED")}>
                          <X /> Reject
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Decided</CardTitle>
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
                      <Badge variant={STATUS_VARIANT[a.status]}>{humanize(a.status)}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      <TabsContent value="scheduled">
        <Card>
          <CardHeader>
            <CardTitle>Queue</CardTitle>
            <CardDescription>Posts grouped by batch across channels.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.posts.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nothing scheduled.</p>
            ) : (
              <ul className="divide-y">
                {data.posts.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 py-3">
                    <Badge variant="muted" className="w-20 justify-center">
                      {PLATFORM_LABEL[p.platform]}
                    </Badge>
                    <p className="min-w-0 flex-1 truncate text-sm">{p.caption}</p>
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      <CalendarClock className="size-3.5" />
                      {p.scheduledFor ? p.scheduledFor.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "unscheduled"}
                    </span>
                    <Badge variant="outline">{humanize(p.status)}</Badge>
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
