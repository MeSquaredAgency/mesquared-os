"use client";

import { useState, useTransition } from "react";
import { Check, PhoneOutgoing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markLeadHandled } from "@/lib/portal/actions";

/** "I've called them": one tap that stops the clock on a lead the client has handled themselves. */
export function LeadHandledButton({ tenantSlug, leadId }: { tenantSlug: string; leadId: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<{ done: boolean; message: string } | null>(null);
  if (state?.done) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-green-text" role="status">
        <Check className="size-3.5" aria-hidden="true" /> Noted
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await markLeadHandled(tenantSlug, leadId);
            setState({ done: result.ok, message: result.message });
          })
        }
        title="Stops the reminders for this lead and marks it handled"
      >
        <PhoneOutgoing /> {pending ? "Saving…" : "I’ve called them"}
      </Button>
      {state && !state.done && (
        <span className="text-xs text-red-text" role="alert">
          {state.message}
        </span>
      )}
    </span>
  );
}
