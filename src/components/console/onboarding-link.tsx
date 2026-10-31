"use client";

import { Check, Copy, Mail } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** A freshly made client link, shown once: copy it, email it, or open it to check. */
export function OnboardingLinkCard({ url, label, contactEmail }: { url: string; label: string; contactEmail?: string | null }) {
  const [copied, setCopied] = useState(false);
  const full = url.startsWith("/") && typeof window !== "undefined" ? `${window.location.origin}${url}` : url;
  const subject = `Your Me² onboarding questionnaire`;
  const body = `Hi,\n\nHere is the link to your Me² onboarding questionnaire for ${label}. It takes about 30 minutes and saves as you go, so you can stop and come back with the same link:\n\n${full}\n\nAny questions, just reply to this email.\n`;
  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <p className="text-sm font-medium">The client’s link (shown once)</p>
      <code className="scrollbar-none block overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs whitespace-nowrap">{full}</code>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(full);
            setCopied(true);
          }}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? "Copied" : "Copy link"}
        </Button>
        <Button asChild size="sm" variant="outline">
          <a href={`mailto:${contactEmail ?? ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}>
            <Mail aria-hidden /> Email it
          </a>
        </Button>
        <Button asChild size="sm" variant="ghost">
          <a href={full} target="_blank" rel="noreferrer">
            Open the form
          </a>
        </Button>
      </div>
    </div>
  );
}
