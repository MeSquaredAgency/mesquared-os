"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowDown, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { isStandalone } from "./install";

const PULL = 72;

/**
 * Pull-to-refresh for the installed app. Browsers give it for free, but an
 * app opened from the Home Screen has none, so here a pull from the very top
 * of the page reloads its data. It never runs in a browser tab, and never
 * when the pull starts inside something that scrolls on its own (the chat).
 */
export function PullToRefresh() {
  const router = useRouter();
  const [on, setOn] = useState(false);
  const [distance, setDistance] = useState(0);
  const [pending, start] = useTransition();
  const from = useRef<number | null>(null);

  useEffect(() => {
    if (!isStandalone() || !window.matchMedia("(pointer: coarse)").matches) return;
    setOn(true);
    const scrolledInside = (target: EventTarget | null) => {
      for (let el = target as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
        if (el.dataset.noPull !== undefined) return true;
        if (el.scrollHeight > el.clientHeight && /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollTop > 0) return true;
      }
      return false;
    };
    const down = (e: TouchEvent) => {
      from.current = window.scrollY <= 0 && e.touches.length === 1 && !scrolledInside(e.target) ? e.touches[0].clientY : null;
    };
    const move = (e: TouchEvent) => {
      if (from.current === null) return;
      const dy = e.touches[0].clientY - from.current;
      if (dy <= 0 || window.scrollY > 0) return setDistance(0);
      setDistance(Math.min(PULL * 1.6, dy * 0.5));
    };
    const up = () => {
      if (from.current !== null) {
        setDistance((d) => {
          if (d >= PULL) {
            navigator.vibrate?.(8);
            start(() => router.refresh());
          }
          return 0;
        });
      }
      from.current = null;
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up, { passive: true });
    window.addEventListener("touchcancel", up, { passive: true });
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", up);
    };
  }, [router]);

  if (!on || (distance === 0 && !pending)) return null;
  const ready = distance >= PULL;
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 z-40 flex justify-center" style={{ top: `calc(env(safe-area-inset-top) + ${pending ? 64 : Math.max(8, distance)}px)`, transition: distance === 0 ? "top 200ms" : undefined }}>
      <span className={cn("flex size-9 items-center justify-center rounded-full border bg-card text-muted-foreground shadow-[0_4px_14px_#1b232c26]", ready && "text-brand")}>
        {pending ? <RefreshCw className="size-4 animate-spin" aria-label="Refreshing" /> : <ArrowDown className="size-4 transition-transform" style={{ transform: `rotate(${ready ? 180 : 0}deg)` }} aria-hidden="true" />}
      </span>
    </div>
  );
}
