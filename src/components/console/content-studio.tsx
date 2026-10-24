"use client";

import { useState, useTransition } from "react";
import { CalendarClock, Check, Link2, Pencil, RefreshCw, Send, Sparkles, Trash2, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/shell/status-badge";
import { PLATFORM_LABEL } from "@/components/shell/platform";
import { SocialInbox, type InboxThread } from "@/components/portal/social-inbox";
import { cancelPostAction, connectChannelAction, createSourceAction, decideDraftAction, generateDraftsAction, markInboxHandledAction, publishNowAction, replyInboxAction, reschedulePostAction, syncNowAction, updateDraftAction } from "@/lib/content/actions";
import { complianceSummary } from "@/lib/content/compliance";
import type { ChannelSummary } from "@/lib/social/metrics";
import type { ContentAssetRecord, SocialPlatform, SocialPostRecord } from "@/lib/types";
import { cn, formatDateTime, humanize, type FormatContext } from "@/lib/utils";

interface Props {
  tenantId: string;
  fmt: Pick<FormatContext, "timezone" | "locale">;
  sources: ContentAssetRecord[];
  drafts: ContentAssetRecord[];
  posts: SocialPostRecord[];
  channels: ChannelSummary[];
  inbox: InboxThread[];
  /** Source id → number of drafts made from it. */
  draftCounts: Record<string, number>;
}

const PLATFORMS: SocialPlatform[] = ["FACEBOOK", "INSTAGRAM", "GOOGLE_BUSINESS", "LINKEDIN", "YOUTUBE", "TIKTOK"];

/** Operator workbench for the content engine and social channels. Every button is a server action scoped to the operator's portfolio. */
export function ContentStudio({ tenantId, fmt, sources, drafts, posts, channels, inbox, draftCounts }: Props) {
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) => start(async () => setNotice(await fn().then((r) => ({ tone: r.ok ? "ok" : "error", text: r.message }))));

  const waiting = drafts.filter((d) => d.status === "IN_REVIEW" || d.status === "REJECTED");
  const queue = posts.filter((p) => p.status !== "PUBLISHED").sort((a, b) => (a.scheduledFor?.getTime() ?? 0) - (b.scheduledFor?.getTime() ?? 0));
  const published = posts.filter((p) => p.status === "PUBLISHED").slice(0, 10);

  return (
    <div className="flex flex-col gap-3">
      {notice && (
        <p role="status" aria-live="polite" className={cn("rounded-md px-3 py-2 text-sm", notice.tone === "ok" ? "bg-green-soft text-green-text" : "bg-red-soft text-red-text")}>
          {notice.text}
        </p>
      )}
      <Tabs defaultValue="drafts">
        <TabsList className="flex-wrap">
          <TabsTrigger value="drafts">
            Drafts <Badge variant={waiting.length ? "secondary" : "muted"}>{waiting.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="material">Material</TabsTrigger>
          <TabsTrigger value="queue">
            Queue <Badge variant="muted">{queue.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="inbox">
            Inbox <Badge variant={inbox.filter((t) => t.conversation.awaitingReply).length ? "secondary" : "muted"}>{inbox.filter((t) => t.conversation.awaitingReply).length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="channels">Channels</TabsTrigger>
        </TabsList>

        <TabsContent value="drafts" className="mt-3">
          <DraftsPanel tenantId={tenantId} drafts={waiting} pending={pending} run={run} fmt={fmt} />
        </TabsContent>
        <TabsContent value="material" className="mt-3">
          <MaterialPanel tenantId={tenantId} sources={sources} draftCounts={draftCounts} pending={pending} run={run} fmt={fmt} />
        </TabsContent>
        <TabsContent value="queue" className="mt-3">
          <QueuePanel tenantId={tenantId} queue={queue} published={published} pending={pending} run={run} fmt={fmt} />
        </TabsContent>
        <TabsContent value="inbox" className="mt-3">
          <SocialInbox threads={inbox} canReply onReply={(id, text) => replyInboxAction(tenantId, id, text)} onHandled={(id) => markInboxHandledAction(tenantId, id)} description="Replies go out under the client's name. Suggested answers come from triage; edit before sending." />
        </TabsContent>
        <TabsContent value="channels" className="mt-3">
          <ChannelsPanel tenantId={tenantId} channels={channels} pending={pending} run={run} fmt={fmt} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type Run = (fn: () => Promise<{ ok: boolean; message: string }>) => void;

function MaterialPanel({ tenantId, sources, draftCounts, pending, run, fmt }: { tenantId: string; sources: ContentAssetRecord[]; draftCounts: Record<string, number>; pending: boolean; run: Run; fmt: Props["fmt"] }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card aria-labelledby="material-new-title">
        <CardHeader>
          <CardTitle id="material-new-title">Add material</CardTitle>
          <CardDescription>Paste a voice-note transcript, notes from a job, a review, a listing description. The engine drafts one post per connected channel.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What is this? e.g. Voice note — owners switching managers" aria-label="Material title" />
          <Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder="The material itself, in the business's own words." aria-label="Material text" />
          <div className="flex gap-2">
            <Button
              variant="green"
              disabled={pending || title.trim().length < 2 || body.trim().length < 20}
              onClick={() =>
                run(async () => {
                  const r = await createSourceAction(tenantId, { title, body, generate: true });
                  if (r.ok) {
                    setTitle("");
                    setBody("");
                  }
                  return r;
                })
              }
            >
              <Sparkles /> Save and draft
            </Button>
            <Button variant="outline" disabled={pending || title.trim().length < 2 || body.trim().length < 20} onClick={() => run(() => createSourceAction(tenantId, { title, body, generate: false }))}>
              Save for the daily batch
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Files (photos, recordings) are uploaded with a content-scoped API key to /api/v1/assets; recordings are transcribed when transcription is configured.</p>
        </CardContent>
      </Card>
      <Card aria-labelledby="material-list-title">
        <CardHeader>
          <CardTitle id="material-list-title">Source material</CardTitle>
          <CardDescription>Everything the engine has to work from.</CardDescription>
        </CardHeader>
        <CardContent>
          {sources.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">Nothing yet.</p>
          ) : (
            <ul className="divide-y">
              {sources.map((s) => (
                <li key={s.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{s.title ?? humanize(s.kind)}</p>
                    <p className="text-xs text-muted-foreground">
                      {humanize(s.kind)} · {formatDateTime(s.createdAt, fmt)} · {draftCounts[s.id] ?? 0} draft{(draftCounts[s.id] ?? 0) === 1 ? "" : "s"}
                      {s.generation.origin ? ` · from ${s.generation.origin}` : ""}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => generateDraftsAction(tenantId, s.id, (draftCounts[s.id] ?? 0) > 0))}>
                    <Sparkles /> {(draftCounts[s.id] ?? 0) > 0 ? "Draft again" : "Draft"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DraftsPanel({ tenantId, drafts, pending, run, fmt }: { tenantId: string; drafts: ContentAssetRecord[]; pending: boolean; run: Run; fmt: Props["fmt"] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ title: string; body: string }>({ title: "", body: "" });
  const [when, setWhen] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  return (
    <Card aria-labelledby="drafts-title">
      <CardHeader>
        <CardTitle id="drafts-title">Drafts to review</CardTitle>
        <CardDescription>Approve routine posts here. Anything with prices, names or claims waits for the client in their portal.</CardDescription>
      </CardHeader>
      <CardContent>
        {drafts.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">Nothing waiting. Add material or let the daily batch run.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {drafts.map((a) => {
              const report = a.generation.compliance;
              const blocked = report ? !report.ok : false;
              const isEditing = editing === a.id;
              return (
                <li key={a.id} className="rounded-lg border p-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <StatusBadge status={a.status} />
                    {a.targetPlatform && <Badge variant="muted">{PLATFORM_LABEL[a.targetPlatform]}</Badge>}
                    <Badge variant="outline">{humanize(a.kind)}</Badge>
                    {a.needsClientSignoff && <Badge variant="secondary">Client sign-off</Badge>}
                    {blocked && <Badge variant="red">Fix needed</Badge>}
                    <span className="text-xs text-muted-foreground">{formatDateTime(a.createdAt, fmt)}</span>
                  </div>
                  {isEditing ? (
                    <div className="flex flex-col gap-2">
                      <Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} aria-label="Draft title" />
                      <Textarea rows={8} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} aria-label="Draft text" />
                      <div className="flex gap-2">
                        <Button size="sm" variant="green" disabled={pending} onClick={() => run(async () => { const r = await updateDraftAction(tenantId, a.id, edit); if (r.ok) setEditing(null); return r; })}>
                          <Check /> Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm font-medium">{a.title}</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{a.body}</p>
                      {a.generation.mediaBrief && <p className="mt-2 text-xs text-muted-foreground">Media: {a.generation.mediaBrief}</p>}
                      {a.generation.claims?.length ? <p className="mt-1 text-xs text-muted-foreground">Claims to check: {a.generation.claims.join("; ")}</p> : null}
                      <p className={cn("mt-2 text-xs", blocked ? "text-red-text" : a.needsClientSignoff ? "text-muted-foreground" : "text-green-text")}>{complianceSummary(report)}</p>
                      {a.rejectionNote && <p className="mt-1 text-xs text-muted-foreground">Sent back: {a.rejectionNote}</p>}
                    </>
                  )}
                  {!isEditing && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="green" disabled={pending || blocked || a.needsClientSignoff} title={a.needsClientSignoff ? "The client signs this one off in their portal" : blocked ? "Fix the flagged issues first" : undefined} onClick={() => run(() => decideDraftAction(tenantId, a.id, "APPROVED", { at: when[a.id] ? new Date(when[a.id]).toISOString() : null }))}>
                        <Check /> Approve
                      </Button>
                      <Input type="datetime-local" className="h-8 w-52 text-xs" value={when[a.id] ?? ""} onChange={(e) => setWhen({ ...when, [a.id]: e.target.value })} aria-label="Schedule for" />
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => { setEditing(a.id); setEdit({ title: a.title ?? "", body: a.body ?? "" }); }}>
                        <Pencil /> Edit
                      </Button>
                      <Input className="h-8 w-56 text-xs" placeholder="Note for the send-back" value={note[a.id] ?? ""} onChange={(e) => setNote({ ...note, [a.id]: e.target.value })} aria-label="Send-back note" />
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => decideDraftAction(tenantId, a.id, "REJECTED", { note: note[a.id] }))}>
                        <X /> Send back
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function QueuePanel({ tenantId, queue, published, pending, run, fmt }: { tenantId: string; queue: SocialPostRecord[]; published: SocialPostRecord[]; pending: boolean; run: Run; fmt: Props["fmt"] }) {
  const [when, setWhen] = useState<Record<string, string>>({});
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card aria-labelledby="queue-title">
        <CardHeader>
          <CardTitle id="queue-title">Scheduled</CardTitle>
          <CardDescription>Goes out at the time shown; move it, publish now, or take it off.</CardDescription>
        </CardHeader>
        <CardContent>
          {queue.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">Nothing in the queue.</p>
          ) : (
            <ul className="divide-y">
              {queue.map((p) => (
                <li key={p.id} className="flex flex-col gap-2 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">
                        {PLATFORM_LABEL[p.platform]} · {p.scheduledFor ? formatDateTime(p.scheduledFor, fmt) : "no time"}
                        {!p.channelId && " · waiting for a channel"}
                      </p>
                      <p className="line-clamp-2 text-sm">{p.caption}</p>
                      {p.errorMessage && <p className="text-xs text-red-text">{p.errorMessage}</p>}
                    </div>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input type="datetime-local" className="h-8 w-52 text-xs" value={when[p.id] ?? ""} onChange={(e) => setWhen({ ...when, [p.id]: e.target.value })} aria-label="New time" />
                    <Button size="sm" variant="outline" disabled={pending || !when[p.id]} onClick={() => run(() => reschedulePostAction(tenantId, p.id, new Date(when[p.id]).toISOString()))}>
                      <CalendarClock /> Move
                    </Button>
                    <Button size="sm" variant="green" disabled={pending || !p.channelId} onClick={() => run(() => publishNowAction(tenantId, p.id))}>
                      <Send /> Publish now
                    </Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => cancelPostAction(tenantId, p.id))}>
                      <Trash2 /> Take off
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card aria-labelledby="published-title">
        <CardHeader>
          <CardTitle id="published-title">Recently published</CardTitle>
          <CardDescription>With the numbers each platform reports.</CardDescription>
        </CardHeader>
        <CardContent>
          {published.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">Nothing published yet.</p>
          ) : (
            <ul className="divide-y">
              {published.map((p) => (
                <li key={p.id} className="py-2.5">
                  <p className="text-xs text-muted-foreground">
                    {PLATFORM_LABEL[p.platform]} · {p.publishedAt ? formatDateTime(p.publishedAt, fmt) : ""}
                    {p.permalink && (
                      <>
                        {" · "}
                        <a className="underline" href={p.permalink} target="_blank" rel="noreferrer">
                          View <Link2 className="inline size-3" />
                        </a>
                      </>
                    )}
                  </p>
                  <p className="line-clamp-2 text-sm">{p.caption}</p>
                  {Object.keys(p.metrics).length > 0 && <p className="text-xs text-muted-foreground">{Object.entries(p.metrics).map(([k, v]) => `${k} ${v}`).join(" · ")}</p>}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ChannelsPanel({ tenantId, channels, pending, run, fmt }: { tenantId: string; channels: ChannelSummary[]; pending: boolean; run: Run; fmt: Props["fmt"] }) {
  const [form, setForm] = useState({ platform: "FACEBOOK" as SocialPlatform, externalAccountId: "", displayName: "", accessToken: "", refreshToken: "", igUserId: "" });
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card aria-labelledby="channels-list-title">
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle id="channels-list-title">Connected channels</CardTitle>
            <CardDescription>Numbers refresh daily; sync now pulls the inbox, reviews and numbers.</CardDescription>
          </div>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => syncNowAction(tenantId))}>
            <RefreshCw /> Sync now
          </Button>
        </CardHeader>
        <CardContent>
          {channels.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">No channels yet.</p>
          ) : (
            <ul className="divide-y">
              {channels.map((s) => (
                <li key={s.channel.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {PLATFORM_LABEL[s.channel.platform]} <span className="text-muted-foreground">· {s.channel.displayName ?? s.channel.externalAccountId}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {s.followers !== null ? `${s.followers.toLocaleString(fmt.locale)} followers` : "no numbers yet"}
                      {s.reach7d !== null ? ` · reach ${s.reach7d.toLocaleString(fmt.locale)} this week` : ""}
                      {s.lastSnapshot ? ` · updated ${formatDateTime(s.lastSnapshot, fmt)}` : ""}
                    </p>
                  </div>
                  <Badge variant={s.channel.isActive ? "green" : "muted"}>{s.channel.isActive ? "Active" : "Off"}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card aria-labelledby="connect-title">
        <CardHeader>
          <CardTitle id="connect-title">Connect a channel</CardTitle>
          <CardDescription>Paste the account id and a token from the platform&apos;s developer flow. Tokens are encrypted and never shown again.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value as SocialPlatform })} aria-label="Platform">
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABEL[p]}
              </option>
            ))}
          </select>
          <Input placeholder={form.platform === "GOOGLE_BUSINESS" ? "accounts/123/locations/456" : form.platform === "LINKEDIN" ? "urn:li:organization:123" : "Account or page id"} value={form.externalAccountId} onChange={(e) => setForm({ ...form, externalAccountId: e.target.value })} aria-label="Account id" />
          {form.platform === "INSTAGRAM" && <Input placeholder="Instagram business account id (if different)" value={form.igUserId} onChange={(e) => setForm({ ...form, igUserId: e.target.value })} aria-label="Instagram user id" />}
          <Input placeholder="Display name" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} aria-label="Display name" />
          <Input type="password" placeholder="Access token" value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} aria-label="Access token" autoComplete="off" />
          {["GOOGLE_BUSINESS", "YOUTUBE", "TIKTOK"].includes(form.platform) && <Input type="password" placeholder="Refresh token (optional)" value={form.refreshToken} onChange={(e) => setForm({ ...form, refreshToken: e.target.value })} aria-label="Refresh token" autoComplete="off" />}
          <Button
            variant="green"
            disabled={pending || !form.externalAccountId || form.accessToken.length < 8}
            onClick={() =>
              run(async () => {
                const r = await connectChannelAction(tenantId, { ...form, refreshToken: form.refreshToken || undefined, igUserId: form.igUserId || undefined, displayName: form.displayName || undefined });
                if (r.ok) setForm({ ...form, externalAccountId: "", displayName: "", accessToken: "", refreshToken: "", igUserId: "" });
                return r;
              })
            }
          >
            <Link2 /> Connect
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
