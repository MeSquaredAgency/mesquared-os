"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import { setWorkspaceAgent } from "@/lib/agents/actions";
import type { AgentAutonomy } from "@/lib/types";

export interface RosterRow {
  key: string;
  name: string;
  responsibilities: string;
  /** What starts its runs. */
  startsOn: string | null;
  /** False while nothing starts the role's runs: it can't be switched on yet. */
  ready: boolean;
  maxAutonomy: AgentAutonomy;
  enabled: boolean;
  autonomy: AgentAutonomy;
}

const LEVELS: { value: AgentAutonomy; label: string; hint: string }[] = [
  { value: "SHADOW", label: "Shadow", hint: "Reads and proposes; nothing is carried out." },
  { value: "SUGGEST", label: "Suggest", hint: "Drafts; a person approves every change." },
  { value: "SUPERVISED", label: "Supervised", hint: "Notes, briefs and reminders on its own; a person approves anything a customer sees." },
  { value: "DELEGATED", label: "Delegated", hint: "As supervised, plus actions this workspace has let go without a person." },
];

/** Each agent this workspace could use: on or off, and how much it may do alone. */
export function AgentRoster({ tenantId, rows }: { tenantId: string; rows: RosterRow[] }) {
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [state, setState] = useState(rows);

  const change = (key: string, patch: { enabled?: boolean; autonomy?: AgentAutonomy }) =>
    startTransition(async () => {
      const result = await setWorkspaceAgent(tenantId, key, patch);
      setNotice({ tone: result.ok ? "ok" : "error", text: result.message });
      if (result.ok) setState((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    });

  return (
    <div className="flex flex-col gap-3">
      <ul className="surface divide-y px-5">
        {state.map((r) => {
          const allowed = LEVELS.slice(0, LEVELS.findIndex((l) => l.value === r.maxAutonomy) + 1);
          return (
            <li key={r.key} className="flex flex-col gap-3 py-4 md:flex-row md:items-center md:gap-6">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {r.name}
                  {!r.ready ? <Badge variant="muted">Coming soon</Badge> : r.enabled ? <Badge variant="green">On</Badge> : <Badge variant="muted">Off</Badge>}
                </p>
                <p className="text-sm text-muted-foreground">{r.responsibilities}</p>
                {r.startsOn && <p className="text-xs text-muted-foreground">Starts on: {r.startsOn}</p>}
              </div>
              {r.ready && (
                <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row sm:items-center">
                  <Select className="sm:w-44" value={r.autonomy} onChange={(e) => change(r.key, { autonomy: e.target.value as AgentAutonomy })} disabled={pending} aria-label={`How much ${r.name} may do alone`}>
                    {allowed.map((l) => (
                      <option key={l.value} value={l.value} title={l.hint}>
                        {l.label}
                      </option>
                    ))}
                  </Select>
                  <Button variant={r.enabled ? "outline" : "default"} onClick={() => change(r.key, { enabled: !r.enabled })} disabled={pending}>
                    {r.enabled ? "Switch off" : "Switch on"}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    </div>
  );
}
