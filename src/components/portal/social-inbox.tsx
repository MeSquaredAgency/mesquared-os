"use client";

import { useState, useTransition } from "react";
import { Check, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { PLATFORM_LABEL } from "@/components/shell/platform";
import type { ConversationRecord, MessageRecord } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";

export interface InboxThread {
  conversation: ConversationRecord;
  messages: MessageRecord[];
}

interface Props {
  threads: InboxThread[];
  /** Who may reply as the business from this surface. */
  canReply: boolean;
  onReply: (conversationId: string, text: string) => Promise<{ ok: boolean; message: string }>;
  onHandled?: (conversationId: string) => Promise<{ ok: boolean; message: string }>;
  title?: string;
  description?: string;
}

const INTENT_LABEL: Record<string, string> = { lead: "Enquiry", question: "Question", praise: "Thanks", complaint: "Needs care", spam: "Set aside", other: "Message" };

/** Comments and messages from every connected channel, with the drafted reply ready to send. */
export function SocialInbox({ threads, canReply, onReply, onHandled, title = "Inbox", description = "Comments and messages waiting for a reply, with a suggested answer you can edit." }: Props) {
  const [pending, start] = useTransition();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const waiting = threads.filter((t) => t.conversation.awaitingReply);

  const send = (id: string, fallback: string) =>
    start(async () => {
      const result = await onReply(id, drafts[id] ?? fallback);
      setNotice({ tone: result.ok ? "ok" : "error", text: result.message });
    });

  return (
    <Card aria-labelledby="inbox-title">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle id="inbox-title">{title}</CardTitle>
          <CardDescription className="mt-1">{description}</CardDescription>
        </div>
        <Badge variant={waiting.length ? "secondary" : "muted"}>{waiting.length} waiting</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {notice && (
          <p role="status" aria-live="polite" className={cn("rounded-md px-3 py-2 text-sm", notice.tone === "ok" ? "bg-green-soft text-green-text" : "bg-red-soft text-red-text")}>
            {notice.text}
          </p>
        )}
        {waiting.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing waiting. New comments and messages show up here within the hour.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {waiting.map(({ conversation: c, messages }) => {
              const last = messages.filter((m) => m.direction === "INBOUND").at(-1);
              const intent = typeof c.meta?.intent === "string" ? c.meta.intent : null;
              return (
                <li key={c.id} className="rounded-lg border p-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="muted">{c.platform ? PLATFORM_LABEL[c.platform] : "Social"}</Badge>
                    <Badge variant="outline">{c.channel === "SOCIAL_DM" ? "Message" : "Comment"}</Badge>
                    {intent && <Badge variant={intent === "complaint" ? "red" : intent === "lead" ? "green" : "secondary"}>{INTENT_LABEL[intent] ?? intent}</Badge>}
                    <span className="text-muted-foreground">
                      {c.displayName ?? "Someone"}
                      {c.lastMessageAt ? ` · ${timeAgo(c.lastMessageAt)}` : ""}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm">{last?.body ?? "(no text)"}</p>
                  {canReply ? (
                    <div className="mt-3 flex flex-col gap-2">
                      <Textarea rows={2} value={drafts[c.id] ?? c.suggestedReply ?? ""} onChange={(e) => setDrafts({ ...drafts, [c.id]: e.target.value })} placeholder="Write a reply as the business…" aria-label={`Reply to ${c.displayName ?? "this message"}`} />
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="green" disabled={pending} onClick={() => send(c.id, c.suggestedReply ?? "")}>
                          <Send /> Send reply
                        </Button>
                        {onHandled && (
                          <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => setNotice({ tone: "ok", text: (await onHandled(c.id)).message }))}>
                            <Check /> Handled elsewhere
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : (
                    c.suggestedReply && <p className="mt-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">Suggested reply: {c.suggestedReply}</p>
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
