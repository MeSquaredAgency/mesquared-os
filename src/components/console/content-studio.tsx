"use client";

import { useState, useTransition } from "react";
import { CalendarClock, Check, Link2, Pencil, RefreshCw, Send, Sparkles, Trash2, X } from "lucide-react";
import { Badge, Count } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Meta } from "@/components/shell/section";
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

/** A card's title line: an h3 and the sentence under it, with room for one action at the right. */
function CardHead({ id, title, lede, action }: { id: string; title: React.ReactNode; lede?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <h3 id={id} className="section-title">
          {title}
        </h3>
        {lede && <p className="mt-0.5 text-sm text-muted-foreground">{lede}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

/** Operator workbench for the content engine and social channels. Every button is a server action scoped to the operator's portfolio. */
export function ContentStudio({ tenantId, fmt, sources, drafts, posts, channels, inbox, draftCounts }: Props) {
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) => start(async () => setNotice(await fn().then((r) => ({ tone: r.ok ? "ok" : "error", text: r.message }))));

  const waiting = drafts.filter((d) => d.status === "IN_REVIEW" || d.status === "REJECTED");
  const queue = posts.filter((p) => p.status !== "PUBLISHED").sort((a, b) => (a.scheduledFor?.getTime() ?? 0) - (b.scheduledFor?.getTime() ?? 0));
  const published = posts.filter((p) => p.status === "PUBLISHED").slice(0, 10);
  const inboxWaiting = inbox.filter((t) => t.conversation.awaitingReply).length;

  return (
    <div className="flex flex-col gap-4">
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      <Tabs defaultValue="drafts">
        <TabsList variant="segment">
          <TabsTrigger value="drafts">
            Drafts <Count n={waiting.length} tone={waiting.length ? "red" : "neutral"} />
          </TabsTrigger>
          <TabsTrigger value="material">Material</TabsTrigger>
          <TabsTrigger value="queue">
            Queue <Count n={queue.length} />
          </TabsTrigger>
          <TabsTrigger value="inbox">
            Inbox <Count n={inboxWaiting} tone={inboxWaiting ? "red" : "neutral"} />
          </TabsTrigger>
          <TabsTrigger value="channels">Channels</TabsTrigger>
        </TabsList>

        <TabsContent value="drafts">
          <DraftsPanel tenantId={tenantId} drafts={waiting} pending={pending} run={run} fmt={fmt} />
        </TabsContent>
        <TabsContent value="material">
          <MaterialPanel tenantId={tenantId} sources={sources} draftCounts={draftCounts} pending={pending} run={run} fmt={fmt} />
        </TabsContent>
        <TabsContent value="queue">
          <QueuePanel tenantId={tenantId} queue={queue} published={published} pending={pending} run={run} fmt={fmt} />
        </TabsContent>
        <TabsContent value="inbox">
          <SocialInbox threads={inbox} canReply onReply={(id, text) => replyInboxAction(tenantId, id, text)} onHandled={(id) => markInboxHandledAction(tenantId, id)} description="Replies go out under the client's name. Suggested answers come from triage; edit before sending." />
        </TabsContent>
        <TabsContent value="channels">
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
  const [imageUrl, setImageUrl] = useState("");
  const imageOk = imageUrl.trim() === "" || /^https:\/\/\S+$/.test(imageUrl.trim());
  const ready = !(pending || title.trim().length < 2 || body.trim().length < 20 || !imageOk);
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section aria-labelledby="material-new-title" className="surface flex flex-col gap-4 p-5">
        <CardHead id="material-new-title" title="Add material" lede="Paste a voice-note transcript, notes from a job, a review, a listing description. The engine drafts one post per connected channel." />
        <Field label="What is this?">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Voice note — owners switching managers" aria-label="Material title" />
        </Field>
        <Field label="The material">
          <Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} placeholder="The material itself, in the business's own words." aria-label="Material text" />
        </Field>
        <Field label="Photo link" hint="Optional (https, JPEG). Instagram posts need one.">
          <Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" aria-label="Image URL" aria-invalid={!imageOk} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!ready}
            onClick={() =>
              run(async () => {
                const r = await createSourceAction(tenantId, { title, body, generate: true, imageUrl: imageUrl.trim() });
                if (r.ok) {
                  setTitle("");
                  setBody("");
                  setImageUrl("");
                }
                return r;
              })
            }
          >
            <Sparkles /> Save and draft
          </Button>
          <Button variant="outline" disabled={!ready} onClick={() => run(() => createSourceAction(tenantId, { title, body, generate: false, imageUrl: imageUrl.trim() }))}>
            Save for the daily batch
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Files (photos, recordings) are uploaded with a content-scoped API key to /api/v1/assets; recordings are transcribed when transcription is configured.</p>
      </section>

      <section aria-labelledby="material-list-title" className="surface flex flex-col gap-3 p-5">
        <CardHead id="material-list-title" title="Source material" lede="Everything the engine has to work from." />
        {sources.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ul className="divide-y">
            {sources.map((s) => {
              const n = draftCounts[s.id] ?? 0;
              return (
                <li key={s.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{s.title ?? humanize(s.kind)}</p>
                    <Meta parts={[humanize(s.kind), formatDateTime(s.createdAt, fmt), `${n} draft${n === 1 ? "" : "s"}`, s.generation.origin ? `from ${s.generation.origin}` : null]} />
                  </div>
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => generateDraftsAction(tenantId, s.id, n > 0))}>
                    <Sparkles /> {n > 0 ? "Draft again" : "Draft"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function DraftsPanel({ tenantId, drafts, pending, run, fmt }: { tenantId: string; drafts: ContentAssetRecord[]; pending: boolean; run: Run; fmt: Props["fmt"] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ title: string; body: string }>({ title: "", body: "" });
  const [when, setWhen] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  return (
    <section aria-labelledby="drafts-title" className="surface flex flex-col gap-3 p-5">
      <CardHead id="drafts-title" title="Drafts to review" lede="Approve routine posts here. Anything with prices, names or claims waits for the client in their portal." />
      {drafts.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">Nothing waiting. Add material or let the daily batch run.</p>
      ) : (
        <ul className="divide-y">
          {drafts.map((a) => {
            const report = a.generation.compliance;
            const blocked = report ? !report.ok : false;
            const isEditing = editing === a.id;
            return (
              <li key={a.id} className="flex flex-col gap-2 py-4">
                <Meta
                  parts={[
                    <StatusBadge key="status" status={a.status} />,
                    a.targetPlatform ? (
                      <Badge key="platform" variant="muted">
                        {PLATFORM_LABEL[a.targetPlatform]}
                      </Badge>
                    ) : null,
                    <Badge key="kind" variant="outline">
                      {humanize(a.kind)}
                    </Badge>,
                    a.needsClientSignoff ? (
                      <Badge key="signoff" variant="amber">
                        Client sign-off
                      </Badge>
                    ) : null,
                    blocked ? (
                      <Badge key="blocked" variant="red">
                        Fix needed
                      </Badge>
                    ) : null,
                    formatDateTime(a.createdAt, fmt),
                  ]}
                  className="flex flex-wrap items-center gap-x-1.5 gap-y-1"
                />
                {isEditing ? (
                  <div className="flex flex-col gap-3">
                    <Field label="Title">
                      <Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} aria-label="Draft title" />
                    </Field>
                    <Field label="Text">
                      <Textarea rows={8} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} aria-label="Draft text" />
                    </Field>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          run(async () => {
                            const r = await updateDraftAction(tenantId, a.id, edit);
                            if (r.ok) setEditing(null);
                            return r;
                          })
                        }
                      >
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
                    <p className="line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{a.body}</p>
                    {a.generation.mediaBrief && <p className="text-xs text-muted-foreground">Media: {a.generation.mediaBrief}</p>}
                    {a.generation.claims?.length ? <p className="text-xs text-muted-foreground">Claims to check: {a.generation.claims.join("; ")}</p> : null}
                    <p className={cn("text-xs", blocked ? "text-red-text" : a.needsClientSignoff ? "text-muted-foreground" : "text-green-text")}>{complianceSummary(report)}</p>
                    {a.rejectionNote && <p className="text-xs text-muted-foreground">Sent back: {a.rejectionNote}</p>}
                  </>
                )}
                {!isEditing && (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Button size="sm" disabled={pending || blocked || a.needsClientSignoff} title={a.needsClientSignoff ? "The client signs this one off in their portal" : blocked ? "Fix the flagged issues first" : undefined} onClick={() => run(() => decideDraftAction(tenantId, a.id, "APPROVED", { at: when[a.id] || null }))}>
                      <Check /> Approve
                    </Button>
                    <Input type="datetime-local" className="h-8 w-auto min-w-0 sm:w-60" value={when[a.id] ?? ""} onChange={(e) => setWhen({ ...when, [a.id]: e.target.value })} aria-label="Schedule for" />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => {
                        setEditing(a.id);
                        setEdit({ title: a.title ?? "", body: a.body ?? "" });
                      }}
                    >
                      <Pencil /> Edit
                    </Button>
                    <Input className="h-8 min-w-40 flex-1 sm:max-w-64" placeholder="Note for the send-back" value={note[a.id] ?? ""} onChange={(e) => setNote({ ...note, [a.id]: e.target.value })} aria-label="Send-back note" />
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
    </section>
  );
}

function QueuePanel({ tenantId, queue, published, pending, run, fmt }: { tenantId: string; queue: SocialPostRecord[]; published: SocialPostRecord[]; pending: boolean; run: Run; fmt: Props["fmt"] }) {
  const [when, setWhen] = useState<Record<string, string>>({});
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section aria-labelledby="queue-title" className="surface flex flex-col gap-3 p-5">
        <CardHead id="queue-title" title="Scheduled" lede="Goes out at the time shown; move it, publish now, or take it off." />
        {queue.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">Nothing in the queue.</p>
        ) : (
          <ul className="divide-y">
            {queue.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Meta parts={[PLATFORM_LABEL[p.platform], p.scheduledFor ? formatDateTime(p.scheduledFor, fmt) : "no time", !p.channelId ? "waiting for a channel" : null]} />
                    <p className="line-clamp-2 text-sm">{p.caption}</p>
                    {p.errorMessage && <p className="text-xs text-red-text">{p.errorMessage}</p>}
                  </div>
                  <StatusBadge status={p.status} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Input type="datetime-local" className="h-8 w-auto min-w-0 sm:w-60" value={when[p.id] ?? ""} onChange={(e) => setWhen({ ...when, [p.id]: e.target.value })} aria-label="New time" />
                  <Button size="sm" variant="outline" disabled={pending || !when[p.id]} onClick={() => run(() => reschedulePostAction(tenantId, p.id, when[p.id]))}>
                    <CalendarClock /> Move
                  </Button>
                  <Button size="sm" disabled={pending || !p.channelId} onClick={() => run(() => publishNowAction(tenantId, p.id))}>
                    <Send /> Publish now
                  </Button>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => (typeof window === "undefined" || window.confirm("Take this post off the calendar? It goes back to approved and will not publish.")) && run(() => cancelPostAction(tenantId, p.id))}>
                    <Trash2 /> Take off
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="published-title" className="surface flex flex-col gap-3 p-5">
        <CardHead id="published-title" title="Recently published" lede="With the numbers each platform reports." />
        {published.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">Nothing published yet.</p>
        ) : (
          <ul className="divide-y">
            {published.map((p) => (
              <li key={p.id} className="flex flex-col gap-1 py-3">
                <Meta
                  parts={[
                    PLATFORM_LABEL[p.platform],
                    p.publishedAt ? formatDateTime(p.publishedAt, fmt) : null,
                    p.permalink ? (
                      <a key="view" className="underline underline-offset-4" href={p.permalink} target="_blank" rel="noreferrer">
                        View <Link2 className="inline size-3" />
                      </a>
                    ) : null,
                  ]}
                />
                <p className="line-clamp-2 text-sm">{p.caption}</p>
                {Object.keys(p.metrics).length > 0 && (
                  <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {Object.entries(p.metrics).map(([k, v]) => (
                      <div key={k} className="flex gap-1">
                        <dt>{k}</dt>
                        <dd className="font-medium text-foreground num">{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ChannelsPanel({ tenantId, channels, pending, run, fmt }: { tenantId: string; channels: ChannelSummary[]; pending: boolean; run: Run; fmt: Props["fmt"] }) {
  const [form, setForm] = useState({ platform: "FACEBOOK" as SocialPlatform, externalAccountId: "", displayName: "", accessToken: "", refreshToken: "", igUserId: "" });
  const n = (v: number | null) => (v === null ? "–" : v.toLocaleString(fmt.locale));
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section aria-labelledby="channels-list-title" className="surface flex flex-col gap-3 p-5">
        <CardHead
          id="channels-list-title"
          title="Connected channels"
          lede="Numbers refresh daily; sync now pulls the inbox, reviews and numbers."
          action={
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => syncNowAction(tenantId))}>
              <RefreshCw /> Sync now
            </Button>
          }
        />
        {channels.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No channels yet.</p>
        ) : (
          <div className="-mx-5">
            <Table className="min-w-[560px]">
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Channel</TH>
                  <TH numeric>Followers</TH>
                  <TH numeric>Reach or views, 7 days</TH>
                  <TH numeric>Engagements, 7 days</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {channels.map((s) => (
                  <TR key={s.channel.id}>
                    <TD>
                      <p className="font-medium">{PLATFORM_LABEL[s.channel.platform]}</p>
                      <p className="text-xs text-muted-foreground">
                        {s.channel.displayName ?? s.channel.externalAccountId}
                        {s.lastSnapshot ? ` · updated ${formatDateTime(s.lastSnapshot, fmt)}` : ""}
                      </p>
                    </TD>
                    <TD numeric>{n(s.followers)}</TD>
                    <TD numeric>{n(s.reach7d ?? s.views7d)}</TD>
                    <TD numeric>{n(s.engagements7d)}</TD>
                    <TD>
                      <Badge variant={s.channel.isActive ? "green" : "muted"}>{s.channel.isActive ? "Active" : "Off"}</Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </section>

      <section aria-labelledby="connect-title" className="surface flex flex-col gap-4 p-5">
        <CardHead id="connect-title" title="Connect a channel" lede="Paste the account id and a token from the platform's developer flow. Tokens are encrypted and never shown again." />
        <Field label="Platform">
          <Select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value as SocialPlatform })} aria-label="Platform">
            {PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {PLATFORM_LABEL[p]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Account id">
          <Input placeholder={form.platform === "GOOGLE_BUSINESS" ? "accounts/123/locations/456" : form.platform === "LINKEDIN" ? "urn:li:organization:123" : form.platform === "INSTAGRAM" ? "Instagram business account id" : form.platform === "FACEBOOK" ? "Facebook page id" : "Account id"} value={form.externalAccountId} onChange={(e) => setForm({ ...form, externalAccountId: e.target.value })} aria-label="Account id" />
        </Field>
        <Field label="Display name">
          <Input placeholder="Display name" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} aria-label="Display name" />
        </Field>
        <Field label="Access token">
          <Input type="password" placeholder={form.platform === "INSTAGRAM" ? "Page access token of the linked Facebook page" : form.platform === "FACEBOOK" ? "Page access token (long-lived)" : "Access token"} value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} aria-label="Access token" autoComplete="off" />
        </Field>
        {["GOOGLE_BUSINESS", "YOUTUBE", "TIKTOK"].includes(form.platform) && (
          <Field label="Refresh token" hint="Optional.">
            <Input type="password" placeholder="Refresh token (optional)" value={form.refreshToken} onChange={(e) => setForm({ ...form, refreshToken: e.target.value })} aria-label="Refresh token" autoComplete="off" />
          </Field>
        )}
        <div>
          <Button
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
        </div>
      </section>
    </div>
  );
}
