"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Panel } from "@/components/shell/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createOnboardingLinkAction } from "@/lib/onboarding/actions";
import { cn } from "@/lib/utils";
import { OnboardingLinkCard } from "./onboarding-link";

/** Platform admin: a private onboarding link for a new client. */
export function NewOnboardingLink() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [label, setLabel] = useState("");
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [made, setMade] = useState<{ url: string; label: string; email: string } | null>(null);

  return (
    <Panel className="flex flex-col gap-4 py-5">
      {notice && (
        <p role="status" aria-live="polite" className={cn("rounded-lg px-4 py-3 text-sm", notice.ok ? "bg-green-soft text-green-text" : "bg-red-soft text-red-text")}>
          {notice.text}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Client’s business name
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Harbour Fitness" maxLength={120} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Their email (optional)
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Fills in the form and the email for you" />
        </label>
      </div>
      <Button
        className="self-start"
        disabled={pending || label.trim().length < 2}
        onClick={() =>
          start(async () => {
            const r = await createOnboardingLinkAction({ label, contactEmail: email || undefined });
            setNotice({ ok: r.ok, text: r.message });
            if (r.ok && r.url) {
              setMade({ url: r.url, label: label.trim(), email: email.trim() });
              setLabel("");
              setEmail("");
              router.refresh();
            }
          })
        }
      >
        Create link
      </Button>
      {made && <OnboardingLinkCard url={made.url} label={made.label} contactEmail={made.email} />}
    </Panel>
  );
}
