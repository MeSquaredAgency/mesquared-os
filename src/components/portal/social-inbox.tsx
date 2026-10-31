"use client";

import { useState, useTransition } from "react";
import { Check, Send } from "lucide-react";
import { Badge, Count } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Textarea } from "@/components/ui/textarea";
import { Empty, Meta, Section } from "@/components/shell/section";
import { PLATFORM_LABEL } from "@/components/shell/platform";
import type { ConversationRecord, MessageRecord } from "@/lib/types";
import { timeAgo } from "@/lib/utils";

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
    <Section id="inbox-title" title={title} lede={description} action={<Count n={waiting.length} tone={waiting.length ? "red" : "neutral"} />}>
      <div className="flex flex-col gap-3">
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        {waiting.length === 0 ? (
          <Empty>Nothing waiting. New comments and messages show up here within the hour.</Empty>
        ) : (
          <ul className="surface divide-y px-5">
            {waiting.map(({ conversation: c, messages }) => {
              const last = messages.filter((m) => m.direction === "INBOUND").at(-1);
              const intent = typeof c.meta?.intent === "string" ? c.meta.intent : null;
              return (
                <li key={c.id} className="flex flex-col gap-3 py-4">
                  <Meta
                    parts={[
                      <Badge key="platform" variant="muted">
                        {c.platform ? PLATFORM_LABEL[c.platform] : "Social"}
                      </Badge>,
                      <Badge key="channel" variant="outline">
                        {c.channel === "SOCIAL_DM" ? "Message" : "Comment"}
                      </Badge>,
                      intent ? (
                        <Badge key="intent" variant={intent === "complaint" ? "red" : intent === "lead" ? "green" : "secondary"}>
                          {INTENT_LABEL[intent] ?? intent}
                        </Badge>
                      ) : null,
                      c.displayName ?? "Someone",
                      c.lastMessageAt ? timeAgo(c.lastMessageAt) : null,
                    ]}
                    className="flex flex-wrap items-center gap-x-1.5 gap-y-1"
                  />
                  <blockquote className="border-l-2 border-border-strong pl-3 text-sm whitespace-pre-wrap">{last?.body ?? "(no text)"}</blockquote>
                  {canReply ? (
                    <div className="flex flex-col gap-2">
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
                    c.suggestedReply && (
                      <p className="text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">Suggested reply:</span> {c.suggestedReply}
                      </p>
                    )
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
