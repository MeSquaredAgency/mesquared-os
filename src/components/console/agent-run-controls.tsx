"use client";

import { useState } from "react";
import { CircleStop, MessageSquarePlus, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Textarea } from "@/components/ui/textarea";
import { cancelRun, pauseRun, resumeRun, steerRun } from "@/lib/agents/actions";
import type { AgentRunStatus } from "@/lib/types";

interface Props {
  tenantId: string;
  runId: string;
  status: AgentRunStatus;
  /** Waiting on an approval: guidance is read once that is decided. */
  waitingOnPerson: boolean;
}

/** Pause, resume, steer and cancel a run that has not finished. */
export function AgentRunControls({ tenantId, runId, status, waitingOnPerson }: Props) {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [guidance, setGuidance] = useState("");

  // A full reload rather than router.refresh(): in a production build the soft refresh of this page is not reliably
  // applied (vercel/next.js#86055), and a stale status here would mislead whoever is steering the run.
  const act = async (fn: () => Promise<{ ok: boolean; message: string }>, after?: () => void) => {
    setPending(true);
    try {
      const result = await fn();
      setNotice({ tone: result.ok ? "ok" : "error", text: result.message });
      if (!result.ok) return;
      after?.();
      window.location.reload();
    } catch {
      setNotice({ tone: "error", text: "That didn’t go through. Check your connection and try again." });
    } finally {
      setPending(false);
    }
  };

  const cancel = () => {
    if (typeof window === "undefined") return;
    const why = window.prompt("Cancel this run? Anything it is waiting on is closed and nothing more is done. Say why, if you like (the reason is kept on the run):", "");
    if (why === null) return;
    act(() => cancelRun(tenantId, runId, why));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {status === "PAUSED" ? (
          <Button onClick={() => act(() => resumeRun(tenantId, runId))} disabled={pending}>
            <Play /> Resume
          </Button>
        ) : (
          <Button variant="outline" onClick={() => act(() => pauseRun(tenantId, runId))} disabled={pending}>
            <Pause /> Pause
          </Button>
        )}
        <Button variant="outline" onClick={cancel} disabled={pending}>
          <CircleStop /> Cancel run
        </Button>
      </div>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          act(() => steerRun(tenantId, runId, guidance), () => setGuidance(""));
        }}
      >
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Guide the agent</span>
          <Textarea value={guidance} onChange={(e) => setGuidance(e.target.value)} placeholder="For example: she prefers a call after 5pm, so suggest that instead of a text." rows={3} maxLength={2000} disabled={pending} />
          <span className="text-xs text-muted-foreground">{waitingOnPerson ? "It reads this once the action it is waiting on has been decided." : status === "PAUSED" ? "It reads this when you resume it." : "It reads this at its next step."}</span>
        </label>
        <Button type="submit" variant="outline" className="w-fit" disabled={pending || !guidance.trim()}>
          <MessageSquarePlus /> Send guidance
        </Button>
      </form>
      {/* Below the buttons, so nothing moves under the pointer when it appears. */}
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    </div>
  );
}
