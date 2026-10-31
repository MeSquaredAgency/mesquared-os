"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldGrid } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { createOnboardingLinkAction } from "@/lib/onboarding/actions";
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
    <div className="surface flex flex-col gap-4 p-5">
      {notice && <Notice tone={notice.ok ? "ok" : "error"}>{notice.text}</Notice>}
      <FieldGrid>
        <Field label="Client’s business name">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Harbour Fitness" maxLength={120} />
        </Field>
        <Field label="Their email (optional)" hint="Fills in the form and the email for you.">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@business.com" />
        </Field>
      </FieldGrid>
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
    </div>
  );
}
