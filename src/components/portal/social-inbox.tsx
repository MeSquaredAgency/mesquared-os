"use client";

import { useState, useTransition } from "react";
import { Check, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Empty, Section } from "@/components/shell/section";
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
    <Section id="inbox-title" title={title} lede={description} action={<Badge variant={waiting.length ? "secondary" : "muted"}>{waiting.length} waiting</Badge>}>
      <div className="flex flex-col gap-3">
        {notice && (
          <p role="status" aria-live="polite" className={cn("rounded-lg px-4 py-3 text-sm", notice.tone === "ok" ? "bg-green-soft text-green-text" : "bg-red-soft text-red-text")}>
            {notice.text}
          </p>
        )}
        {waiting.length === 0 ? (
          <Empty>Nothing waiting. New comments and messages show up here within the hour.</Empty>
        ) : (
          <ul className="flex flex-col gap-3">
            {waiting.map(({ conversation: c, messages }) => {
              const last = messages.filter((m) => m.direction === "INBOUND").at(-1);
              const intent = typeof c.meta?.intent === "string" ? c.meta.intent : null;
              return (
                <li key={c.id} className="rounded-xl border bg-card p-5">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant="muted">{c.platform ? PLATFORM_LABEL[c.platform] : "Social"}</Badge>
                    <Badge variant="outline">{c.channel === "SOCIAL_DM" ? "Message" : "Comment"}</Badge>
                    {intent && <Badge variant={intent === "complaint" ? "red" : intent === "lead" ? "green" : "secondary"}>{INTENT_LABEL[intent] ?? intent}</Badge>}
                    <span className="text-muted-foreground">
                      {c.displayName ?? "Someone"}
                      {c.lastMessageAt ? ` · ${timeAgo(c.lastMessageAt)}` : ""}
                    </span>
                  </div>
                  <p className="max-w-[86%] rounded-[19px] rounded-bl-[6px] bg-secondary px-4 py-2.5 text-base leading-snug whitespace-pre-wrap">{last?.body ?? "(no text)"}</p>
                  {canReply ? (
                    <div className="mt-4 flex flex-col gap-3">
                      <Textarea rows={2} value={drafts[c.id] ?? c.suggestedReply ?? ""} onChange={(e) => setDrafts({ ...drafts, [c.id]: e.target.value })} placeholder="Write a reply as the business…" aria-label={`Reply to ${c.displayName ?? "this message"}`} />
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" disabled={pending} onClick={() => send(c.id, c.suggestedReply ?? "")}>
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
                    c.suggestedReply && <p className="mt-3 rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">Suggested reply: {c.suggestedReply}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Section>
  );
}
