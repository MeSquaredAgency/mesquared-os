"use client";

import { useEffect, useState } from "react";
import { RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** One automatic retry per error, then the person decides. Kept in sessionStorage so a persistent error cannot loop. */
const AUTO_RETRY_KEY = "portal-error-retry";
const AUTO_RETRY_WINDOW_MS = 30_000;

function shouldAutoRetry(reference: string): boolean {
  try {
    const raw = sessionStorage.getItem(AUTO_RETRY_KEY);
    const last = raw ? (JSON.parse(raw) as { reference: string; at: number }) : null;
    if (last && last.reference === reference && Date.now() - last.at < AUTO_RETRY_WINDOW_MS) return false;
    sessionStorage.setItem(AUTO_RETRY_KEY, JSON.stringify({ reference, at: Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export default function PortalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [retrying, setRetrying] = useState(false);
  const reference = error.digest ?? error.message;

  useEffect(() => {
    console.error("[portal]", error);
    if (!shouldAutoRetry(reference)) return;
    setRetrying(true);
    const timer = setTimeout(reset, 800);
    return () => clearTimeout(timer);
  }, [error, reference, reset]);

  return (
    <div role="alert" className="surface mx-auto mt-10 flex max-w-md flex-col items-start gap-4 p-6">
      <p className="eyebrow">Something went wrong</p>
      <div>
        <h1 className="section-title">{retrying ? "Loading again…" : "This page didn’t load"}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{retrying ? "The first attempt failed; trying once more." : "Try again in a moment. If it keeps happening, tell your Me² person and quote the reference below."}</p>
        {error.digest && <p className="mt-2 text-xs text-muted-foreground num">Reference: {error.digest}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={reset} variant="outline" size="sm" disabled={retrying}>
          <RotateCcw /> Try again
        </Button>
        <Button onClick={() => window.location.reload()} variant="ghost" size="sm">
          <RefreshCw /> Reload the page
        </Button>
      </div>
    </div>
  );
}
