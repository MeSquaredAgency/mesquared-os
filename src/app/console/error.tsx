"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ConsoleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[console]", error);
  }, [error]);
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-red-soft text-red-text">
        <AlertTriangle className="size-6" />
      </span>
      <div>
        <h1 className="text-lg">Something went wrong</h1>
        <p className="mt-1 text-sm text-muted-foreground">Try again. If it keeps happening, check the server log.</p>
        {error.digest && <p className="mt-2 text-xs text-muted-foreground">Reference: {error.digest}</p>}
      </div>
      <Button onClick={reset} variant="outline">
        <RotateCcw /> Try again
      </Button>
    </div>
  );
}
