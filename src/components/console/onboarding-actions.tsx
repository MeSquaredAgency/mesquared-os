"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Panel } from "@/components/shell/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { provisionFromOnboardingAction, renewOnboardingLinkAction, reopenOnboardingAction, withdrawOnboardingAction } from "@/lib/onboarding/actions";
import type { OnboardingStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { OnboardingLinkCard } from "./onboarding-link";

interface Props {
  id: string;
  label: string;
  contactEmail: string | null;
  status: OnboardingStatus;
  draftSlug: string;
  blockers: string[];
}

/** What an admin can do with one questionnaire: create the workspace, reopen it, send a new link, or withdraw it. */
export function OnboardingActions({ id, label, contactEmail, status, draftSlug, blockers }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [slug, setSlug] = useState(draftSlug);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; message: string; slug?: string; url?: string }>) =>
    start(async () => {
      const r = await fn();
      setNotice({ ok: r.ok, text: r.message });
      if (r.url) setLink(r.url);
      if (r.ok && r.slug) router.push(`/console/${r.slug}/settings`);
      else router.refresh();
    });

  return (
    <Panel className="flex flex-col gap-4 py-5">
      {notice && (
        <p role="status" aria-live="polite" className={cn("rounded-lg px-4 py-3 text-sm", notice.ok ? "bg-green-soft text-green-text" : "bg-red-soft text-red-text")}>
          {notice.text}
        </p>
      )}
      {status === "SUBMITTED" && (
        <div className="flex flex-col gap-3">
          <label className="flex max-w-md flex-col gap-1 text-sm font-medium">
            Workspace address
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="letters, numbers and dashes" />
          </label>
          {blockers.length > 0 && (
            <ul className="flex list-disc flex-col gap-1 rounded-lg bg-red-soft py-3 pr-4 pl-8 text-sm text-red-text">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button disabled={pending || blockers.length > 0} onClick={() => run(() => provisionFromOnboardingAction(id, { slug }))}>
              Create workspace
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => run(() => reopenOnboardingAction(id))}>
              Reopen for the client
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">Creating it applies the drafted settings, invites the team with a password nobody sees, and assigns you as operator. Reset each person’s password from Settings → People to hand it over.</p>
        </div>
      )}
      {(status === "INVITED" || status === "IN_PROGRESS" || status === "SUBMITTED") && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={pending} onClick={() => run(() => renewOnboardingLinkAction(id))}>
            New link
          </Button>
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => {
              if (window.confirm(`Withdraw ${label}'s questionnaire? Their link will stop working.`)) run(() => withdrawOnboardingAction(id));
            }}
          >
            Withdraw
          </Button>
        </div>
      )}
      {link && <OnboardingLinkCard url={link} label={label} contactEmail={contactEmail} />}
    </Panel>
  );
}
