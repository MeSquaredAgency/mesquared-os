"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Empty, Section } from "@/components/shell/section";
import { StatusBadge } from "@/components/shell/status-badge";
import { COPY } from "@/lib/copy";
import { decideAsset } from "@/lib/marketing/actions";
import type { ContentAssetRecord, ContentStatus } from "@/lib/types";
import { humanize } from "@/lib/utils";
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
    <Section id="content-title" title={COPY.awaitingApproval} lede={waiting.length === 0 ? "Nothing waiting for approval." : "Drafts we prepared and checked. Approve to schedule, or send back with a note."}>
      <div className="flex flex-col gap-3">
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        {waiting.length === 0 ? (
          <Empty>Every draft has been decided. New ones we prepare for you land here.</Empty>
        ) : (
          <ul className="surface divide-y px-5">
            {waiting.map((a) => {
              const blocked = a.needsClientSignoff && !isMember;
              return (
                <li key={a.id} className="flex flex-col gap-2 py-4">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={a.status} />
                    <Badge variant="outline">{humanize(a.kind)}</Badge>
                    {a.targetPlatform && <Badge variant="muted">{PLATFORM_LABEL[a.targetPlatform]}</Badge>}
                    {a.needsClientSignoff && <Badge variant="amber">Needs your sign-off</Badge>}
                  </div>
                  <p className="text-sm font-medium">{a.title}</p>
                  <p className="line-clamp-3 text-sm whitespace-pre-wrap text-muted-foreground">{a.body}</p>
                  {fileLinks?.[a.id] && (
                    <a className="w-fit text-xs underline underline-offset-4" href={fileLinks[a.id]} target="_blank" rel="noreferrer">
                      View file
                    </a>
                  )}
                  {canApprove ? (
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Button size="sm" onClick={() => decide(a.id, "APPROVED")} disabled={pending || blocked} title={blocked ? "Mentions prices, names or claims: the client signs this off" : undefined}>
                        <Check /> Approve
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => decide(a.id, "REJECTED")} disabled={pending}>
                        <X /> Send back
                      </Button>
                      {blocked && <span className="text-xs text-muted-foreground">Client sign-off required</span>}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Someone with approval rights decides this.</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Section>
  );
}
