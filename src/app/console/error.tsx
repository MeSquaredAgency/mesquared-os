"use client";

import { useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ConsoleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[console]", error);
  }, [error]);
  return (
    <div role="alert" className="surface mx-auto mt-10 flex max-w-md flex-col items-start gap-4 p-6">
      <p className="eyebrow">Something went wrong</p>
      <div>
        <h1 className="section-title">This page didn’t load</h1>
        <p className="mt-1 text-sm text-muted-foreground">Try again. If it keeps happening, check the server log.</p>
        {error.digest && <p className="mt-2 text-xs text-muted-foreground num">Reference: {error.digest}</p>}
      </div>
      <Button onClick={reset} variant="outline" size="sm">
        <RotateCcw /> Try again
      </Button>
    </div>
  );
}
