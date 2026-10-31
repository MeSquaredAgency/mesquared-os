import type { Metadata } from "next";
import { OnboardingForm, OnboardingSent } from "@/components/onboarding/onboarding-form";
import { BrandMark } from "@/components/shell/app-shell";
import { sanitizeAnswers } from "@/lib/onboarding/form";
import { isEditable, openOnboarding } from "@/lib/onboarding/service";

export const dynamic = "force-dynamic";

// The link is private: keep it out of search results and out of any Referer header.
export const metadata: Metadata = { title: "Your Me² onboarding", robots: { index: false, follow: false }, referrer: "no-referrer" };

const CLOSED: Record<string, { title: string; body: string }> = {
  not_found: { title: "This link isn't valid", body: "It may have been replaced with a new one. Ask your Me² onboarding lead to send you the current link." },
  expired: { title: "This link has expired", body: "Links stay open for 60 days. Ask your Me² onboarding lead for a new one; anything you already filled in is kept." },
  withdrawn: { title: "This questionnaire was withdrawn", body: "Ask your Me² onboarding lead if that's a surprise." },
};

/**
 * /onboarding/<token>: the client's onboarding questionnaire. The token in the
 * path is the only credential (stored as a hash), so this page is public in
 * the middleware and shows nothing but the form it opens.
 */
export default async function OnboardingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const opened = await openOnboarding(token);

  if (!opened.ok) {
    const closed = CLOSED[opened.reason];
    return (
      <Frame>
        <Card>
          <p className="eyebrow">Me² onboarding</p>
          <h1 className="page-title">{closed.title}</h1>
          <p className="lede">{closed.body}</p>
        </Card>
      </Frame>
    );
  }

  const { record } = opened;
  if (record.status === "PROVISIONED") {
    return (
      <Frame>
        <Card>
          <p className="eyebrow">Me² onboarding</p>
          <h1 className="page-title">Your Me² portal is being set up</h1>
          <p className="lede">Thank you for your answers. Your onboarding lead will be in touch with your sign-in details.</p>
        </Card>
      </Frame>
    );
  }
  if (!isEditable(record)) {
    return (
      <Frame>
        <OnboardingSent label={record.label} answers={sanitizeAnswers(record.answers)} />
      </Frame>
    );
  }

  return (
    <Frame>
      <OnboardingForm token={token} label={record.label} initial={sanitizeAnswers(record.answers, "client")} fresh={record.status === "INVITED"} />
    </Frame>
  );
}

/** The public page's own chrome: the brand mark, a paper background, one column. */
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main data-theme="paper" className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="mx-auto flex w-full max-w-2xl items-center justify-between px-4 pt-6 sm:px-6 sm:pt-8">
        <BrandMark tone="paper" className="h-6" />
        <span className="text-xs text-muted-foreground">People, backed by AI.</span>
      </header>
      <div className="mx-auto w-full max-w-2xl flex-1 px-4 py-8 sm:px-6 sm:py-10">{children}</div>
    </main>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="surface flex w-full flex-col gap-3 p-6 sm:p-9">{children}</div>;
}
