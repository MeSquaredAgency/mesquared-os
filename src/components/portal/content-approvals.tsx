"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shell/status-badge";
import { COPY } from "@/lib/copy";
import { decideAsset } from "@/lib/marketing/actions";
import type { ContentAssetRecord, ContentStatus } from "@/lib/types";
import { cn, humanize } from "@/lib/utils";
import { PLATFORM_LABEL } from "@/components/shell/platform";

interface Props {
  tenantSlug: string;
  assets: ContentAssetRecord[];
  canApprove: boolean;
  /** Tenant members may sign off assets flagged for the client; operators approve the routine ones. */
  isMember: boolean;
  /** Asset id → presigned URL for assets with a file on Neon Object Storage (minted on the server). */
  fileLinks?: Record<string, string>;
}

/** Content waiting for approval. Decisions persist through a server action with an optimistic overlay. */
export function ContentApprovals({ tenantSlug, assets, canApprove, isMember, fileLinks }: Props) {
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [items, apply] = useOptimistic(assets, (current: ContentAssetRecord[], change: { id: string; status: ContentStatus }) =>
    current.map((a) => (a.id === change.id ? { ...a, status: change.status } : a)),
  );
  const waiting = items.filter((a) => a.status === "IN_REVIEW");

  const decide = (id: string, status: ContentStatus) =>
    startTransition(async () => {
      apply({ id, status });
      const result = await decideAsset(tenantSlug, id, status);
      setNotice({ tone: result.ok ? "ok" : "error", text: result.message });
    });

  return (
    <Card aria-labelledby="content-title">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle id="content-title">{COPY.awaitingApproval}</CardTitle>
          <CardDescription className="mt-1">Drafts the engine prepared. Approve to schedule, or send back.</CardDescription>
        </div>
        <Badge variant={waiting.length ? "secondary" : "muted"}>{waiting.length}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {notice && (
          <p role="status" aria-live="polite" className={cn("rounded-md px-3 py-2 text-sm", notice.tone === "ok" ? "bg-green-soft text-green-text" : "bg-red-soft text-red-text")}>
            {notice.text}
          </p>
        )}
        {waiting.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing waiting for approval.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {waiting.map((a) => {
              const blocked = a.needsClientSignoff && !isMember;
              return (
                <li key={a.id} className="rounded-lg border p-3">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <StatusBadge status={a.status} />
                    <Badge variant="outline">{humanize(a.kind)}</Badge>
                    {a.targetPlatform && <Badge variant="muted">{PLATFORM_LABEL[a.targetPlatform]}</Badge>}
                    {a.needsClientSignoff && <Badge variant="secondary">Needs your sign-off</Badge>}
                  </div>
                  <p className="text-sm font-medium">{a.title}</p>
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{a.body}</p>
                  {fileLinks?.[a.id] && (
                    <a className="mt-1 inline-block text-xs underline" href={fileLinks[a.id]} target="_blank" rel="noreferrer">
                      View file
                    </a>
                  )}
                  {canApprove ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button size="sm" variant="green" onClick={() => decide(a.id, "APPROVED")} disabled={pending || blocked} title={blocked ? "Mentions prices, names or claims: the client signs this off" : undefined}>
                        <Check /> Approve
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => decide(a.id, "REJECTED")} disabled={pending}>
                        <X /> Send back
                      </Button>
                      {blocked && <span className="text-xs text-muted-foreground">Client sign-off required</span>}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-muted-foreground">Someone with approval rights decides this.</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
