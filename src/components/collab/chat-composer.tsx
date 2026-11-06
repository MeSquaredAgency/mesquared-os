"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { SendHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { sendChatAction } from "@/lib/chat/actions";
import { cn } from "@/lib/utils";

/** Pulls new messages while the page is visible, without any chrome. */
function useLiveRefresh(intervalMs: number) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    const onFocus = () => router.refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [intervalMs, router]);
}

/** Enter sends, Shift+Enter starts a new line. The box grows with the message up to a few lines. */
export function ChatComposer({ slug, placeholder, maxLength }: { slug: string; placeholder: string; maxLength: number }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const box = useRef<HTMLTextAreaElement>(null);
  useLiveRefresh(8000);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  const send = () => {
    const body = text.trim();
    if (!body || pending) return;
    start(async () => {
      setError(null);
      const r = await sendChatAction(slug, body);
      if (!r.ok) return setError(r.message);
      setText("");
      router.refresh();
      box.current?.focus();
    });
  };

  return (
    <form
      className="border-t bg-card/80 p-3 backdrop-blur sm:p-4"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {error && (
        <p role="alert" className="mb-2 text-sm text-red-text">
          {error}
        </p>
      )}
      <div className="flex items-end gap-2 rounded-xl border bg-background px-3 py-2 shadow-[0_1px_2px_#1b232c0a] focus-within:border-ring focus-within:ring-4 focus-within:ring-ring/15">
        <textarea
          ref={box}
          rows={1}
          value={text}
          maxLength={maxLength}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={placeholder}
          aria-label="Message"
          className="max-h-44 min-h-6 flex-1 resize-none bg-transparent py-1 text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
        />
        <Button type="submit" size="icon" className={cn("size-8 shrink-0 rounded-lg", !text.trim() && "opacity-50")} disabled={pending || !text.trim()} aria-label="Send">
          <SendHorizontal />
        </Button>
      </div>
      <p className="mt-1.5 px-1 text-2xs text-muted-foreground">Enter to send, Shift + Enter for a new line</p>
    </form>
  );
}
