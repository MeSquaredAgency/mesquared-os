"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Bot, Check, Hand, Pencil, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Meta } from "@/components/shell/section";
import { decideAgentApproval } from "@/lib/agents/actions";
import type { AgentApprovalView } from "@/lib/agents/views";
import type { ExceptionRecord, TenantOption } from "@/lib/types";
import { timeAgo } from "@/lib/utils";

interface Props {
  item: ExceptionRecord;
  view: AgentApprovalView;
  tenant: TenantOption | undefined;
  disabled: boolean;
  onDone: (result: { ok: boolean; message: string }) => void;
}

function expiresIn(at: Date, now = new Date()): string {
  const hours = Math.max(0, Math.round((at.getTime() - now.getTime()) / 3_600_000));
  if (hours < 1) return "expires within the hour";
  if (hours < 48) return `expires in ${hours} hour${hours === 1 ? "" : "s"}`;
  return `expires in ${Math.round(hours / 24)} days`;
}

/**
 * An agent waiting on a person. The card shows the exact effect and the agent's reason; the person approves it,
 * edits the one field the tool allows and approves that, declines with a note the agent reads, or takes the work over.
 */
export function AgentApprovalCard({ item, view, tenant, disabled, onDone }: Props) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(view.edit?.value ?? "");
  const busy = pending || disabled;
  // Only the client approves these; an operator can still decline or take over.
  const clientOnly = Boolean(view.signoff);

  const decide = (action: "approve" | "decline" | "take_over") =>
    startTransition(async () => {
      onDone(await decideAgentApproval(item.tenantId, view.toolCallId, { action, ...(action === "decline" ? { note } : {}), ...(action === "approve" && editing ? { edit: draft } : {}) }));
    });

  const takeOver = () => {
    if (typeof window !== "undefined" && !window.confirm("Take this over? The agent stops, nothing it asked to do is done, and the work is yours.")) return;
    decide("take_over");
  };

  const cancelEdit = () => {
    setEditing(false);
    setDraft(view.edit?.value ?? "");
  };

  return (
    <li className="surface flex gap-4 p-5">
      <Bot className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-4 lg:flex-row lg:items-start lg:gap-8">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Meta
            parts={[
              tenant ? (
                <Link href={`/console/${tenant.slug}`} className="font-medium text-foreground hover:underline">
                  {tenant.name}
                </Link>
              ) : null,
              timeAgo(item.createdAt),
              "Agent approval",
              expiresIn(view.expiresAt),
            ]}
          />
          <p className="text-md font-medium">
            {view.agentName} wants to {view.title}.
          </p>
          {editing && view.edit ? (
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">{view.edit.label}</span>
              <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy} rows={5} />
            </label>
          ) : (
            view.body && <p className="whitespace-pre-wrap rounded-md border bg-muted/40 px-3 py-2 text-sm">{view.body}</p>
          )}
          {view.why && (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Why:</span> {view.why}
            </p>
          )}
          {view.signoff && (
            <p className="text-sm text-amber-text">
              <span className="font-medium">Needs the client’s sign-off:</span> {view.signoff}{" "}
              {view.signoffBy ? `${view.signoffBy} has it in their portal.` : "Nobody at the client is named for agent sign-off, so anyone there who approves content can approve it in their portal."}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {view.policy}{" "}
            {tenant && (
              <Link href={`/console/${tenant.slug}/agents/runs/${view.runId}`} className="underline underline-offset-4 hover:text-foreground">
                See the whole run
              </Link>
            )}
          </p>
          {item.escalatedToUserId && <Badge variant="secondary">Escalated to the client</Badge>}
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto lg:flex-col lg:items-stretch">
          <Input placeholder="If declining, tell the agent why" value={note} onChange={(e) => setNote(e.target.value)} className="sm:w-64" aria-label="Why you are declining" disabled={busy} />
          <div className="flex gap-2">
            <Button onClick={() => decide("approve")} disabled={busy || clientOnly} className="flex-1" title={clientOnly ? "Only the client can approve this one" : undefined}>
              <Check /> {editing ? "Approve edit" : "Approve"}
            </Button>
            {view.edit && !clientOnly && (
              <Button variant="outline" onClick={editing ? cancelEdit : () => setEditing(true)} disabled={busy}>
                {editing ? "Undo edit" : (
                  <>
                    <Pencil /> Edit
                  </>
                )}
              </Button>
            )}
            <Button variant="outline" onClick={() => decide("decline")} disabled={busy}>
              <X /> Decline
            </Button>
          </div>
          <Button variant="ghost" size="sm" onClick={takeOver} disabled={busy}>
            <Hand /> Take over
          </Button>
        </div>
      </div>
    </li>
  );
}
