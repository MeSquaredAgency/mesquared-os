"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Re-fetches the current server-rendered page on an interval so "live" lists
 * actually move. Pauses when the tab is hidden and lets the operator pause it.
 */
export function AutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  const [secondsAgo, setSecondsAgo] = useState(0);

  useEffect(() => {
    const tick = setInterval(() => setSecondsAgo((s) => s + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      router.refresh();
      setSecondsAgo(0);
    }, intervalMs);
    return () => clearInterval(id);
  }, [paused, intervalMs, router]);

  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground" role="status" aria-live="polite">
      <span className={paused ? "" : "inline-flex items-center gap-1.5"}>
        {!paused && <span className="size-1.5 rounded-full bg-green motion-safe:animate-pulse" aria-hidden="true" />}
        {paused ? "Paused" : `Updated ${secondsAgo}s ago`}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        onClick={() => {
          router.refresh();
          setSecondsAgo(0);
        }}
        aria-label="Refresh now"
        title="Refresh now"
      >
        <RefreshCw />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        onClick={() => setPaused((p) => !p)}
        aria-label={paused ? "Resume auto-refresh" : "Pause auto-refresh"}
        aria-pressed={paused}
        title={paused ? "Resume" : "Pause"}
      >
        {paused ? <Play /> : <Pause />}
      </Button>
    </div>
  );
}
