"use client";

import { useState, useTransition } from "react";
import { Check, Pencil, X } from "lucide-react";
import { Section } from "@/components/shell/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Textarea } from "@/components/ui/textarea";
import { decideAgentSignoff } from "@/lib/agents/actions";
import type { AgentApprovalView } from "@/lib/agents/views";

/**
 * Messages an agent has ready that only the client may approve: a price, a promise, a reply to a complaint. The
 * client reads exactly what would go, and approves it, edits it first, or declines with a reason.
 */
export function AgentSignoffs({ tenantSlug, items }: { tenantSlug: string; items: AgentApprovalView[] }) {
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const waiting = items.filter((i) => !done.has(i.toolCallId));
  if (items.length === 0 && !notice) return null;
  return (
    <Section id="signoffs-title" title="Messages waiting for your OK" lede="Our assistant has these ready, but they mention a price, make a promise or answer a complaint, so they only go if you approve them.">
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {waiting.length > 0 && (
        <ul className="surface rise-stagger divide-y px-5">
          {waiting.map((item) => (
            <Signoff
              key={item.toolCallId}
              tenantSlug={tenantSlug}
              item={item}
              onDone={(result) => {
                setNotice({ tone: result.ok ? "ok" : "error", text: result.message });
                if (result.ok) setDone((prev) => new Set([...prev, item.toolCallId]));
              }}
            />
          ))}
        </ul>
      )}
    </Section>
  );
}

function Signoff({ tenantSlug, item, onDone }: { tenantSlug: string; item: AgentApprovalView; onDone: (r: { ok: boolean; message: string }) => void }) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.edit?.value ?? "");
  const [note, setNote] = useState("");

  const decide = (approve: boolean) =>
    startTransition(async () => {
      onDone(await decideAgentSignoff(tenantSlug, item.toolCallId, { approve, ...(approve ? (editing ? { edit: draft } : {}) : { note }) }));
    });

  return (
    <li className="flex flex-col gap-3 py-4">
      <p className="text-md font-medium">Ready to {item.title}</p>
      {editing && item.edit ? (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{item.edit.label}</span>
          <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} disabled={pending} rows={5} />
        </label>
      ) : (
        item.body && <p className="whitespace-pre-wrap rounded-md border bg-muted/40 px-3 py-2 text-sm">{item.body}</p>
      )}
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Why it needs you:</span> {item.signoff}
      </p>
      {item.why && (
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">Why send it:</span> {item.why}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button onClick={() => decide(true)} disabled={pending}>
          <Check /> {editing ? "Approve my edit" : "Approve"}
        </Button>
        {item.edit && (
          <Button variant="outline" onClick={() => (editing ? (setEditing(false), setDraft(item.edit?.value ?? "")) : setEditing(true))} disabled={pending}>
            {editing ? "Undo edit" : (
              <>
                <Pencil /> Edit
              </>
            )}
          </Button>
        )}
        <Input placeholder="If declining, say why (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="sm:w-64" aria-label="Why you are declining" disabled={pending} />
        <Button variant="outline" onClick={() => decide(false)} disabled={pending}>
          <X /> Decline
        </Button>
      </div>
    </li>
  );
}
