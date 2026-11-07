import { Lock } from "lucide-react";
import { Avatar } from "@/components/shell/avatar";
import type { ChatView } from "@/lib/chat";
import type { Side, TenantSummary } from "@/lib/types";
import { cn, formatTime } from "@/lib/utils";

function dayKey(d: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function dayLabel(d: Date, tenant: TenantSummary, now: Date) {
  const key = dayKey(d, tenant.timezone);
  if (key === dayKey(now, tenant.timezone)) return "Today";
  if (key === dayKey(new Date(now.getTime() - 86_400_000), tenant.timezone)) return "Yesterday";
  return new Intl.DateTimeFormat(tenant.locale, { timeZone: tenant.timezone, weekday: "long", day: "numeric", month: "long" }).format(d);
}

/**
 * The conversation, oldest at the top. The reader's own side sits on the
 * right; consecutive messages from one person within five minutes share a
 * header. The scroll box is reversed so it opens at the latest message.
 */
export function ChatThread({ messages, viewer, viewerId, tenant, now }: { messages: ChatView[]; viewer: Side; viewerId: string; tenant: TenantSummary; now: Date }) {
  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
        <span className="flex size-10 items-center justify-center rounded-full bg-accent text-muted-foreground">
          <Lock className="size-4" aria-hidden="true" />
        </span>
        <p className="text-sm font-medium">No messages yet</p>
        <p className="max-w-sm text-sm text-muted-foreground">{viewer === "CLIENT" ? "Ask Me² anything here. Your account team gets an email the moment you write." : `Write to the ${tenant.name} team. They get an email the moment you write.`}</p>
      </div>
    );
  }
  let lastDay = "";
  return (
    <div className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-4 py-4 sm:px-6" tabIndex={0} aria-label="Messages" data-no-pull>
      <ol className="flex flex-col gap-1">
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const day = dayKey(m.createdAt, tenant.timezone);
          const newDay = day !== lastDay;
          lastDay = day;
          const grouped = !newDay && prev && prev.authorId === m.authorId && m.createdAt.getTime() - prev.createdAt.getTime() < 5 * 60_000;
          const mine = m.side === viewer;
          const self = m.authorId === viewerId;
          return (
            <li key={m.id} className="flex flex-col">
              {newDay && (
                <div className="my-3 flex items-center gap-3 text-2xs font-medium tracking-wide text-muted-foreground uppercase" role="separator">
                  <span className="h-px flex-1 bg-border" />
                  {dayLabel(m.createdAt, tenant, now)}
                  <span className="h-px flex-1 bg-border" />
                </div>
              )}
              <div className={cn("flex items-end gap-2.5", mine && "flex-row-reverse", !grouped && "mt-2")}>
                {grouped ? <span className="w-7 shrink-0" aria-hidden="true" /> : <Avatar name={m.authorName} size="sm" />}
                <div className={cn("flex max-w-[min(34rem,80%)] flex-col gap-1", mine && "items-end")}>
                  {!grouped && (
                    <span className="flex items-baseline gap-1.5 px-1 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{self ? "You" : m.authorName}</span>
                      {m.side === "ME2" && viewer === "CLIENT" && <span>Me²</span>}
                      <time dateTime={m.createdAt.toISOString()}>{formatTime(m.createdAt, tenant)}</time>
                    </span>
                  )}
                  <p
                    className={cn(
                      "rounded-2xl px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap",
                      mine ? "rounded-br-md bg-navy text-white shadow-[0_1px_2px_#1b232c33]" : "rounded-bl-md border bg-card shadow-[0_1px_2px_#1b232c0f]",
                      m.text === null && "italic opacity-70",
                    )}
                  >
                    {m.text ?? "This message couldn't be decrypted."}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
