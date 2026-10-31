import type { Metadata } from "next";
import { OnboardingForm, OnboardingSent } from "@/components/onboarding/onboarding-form";
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
          <p className="kicker">Me² onboarding</p>
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
          <p className="kicker">Me² onboarding</p>
          <h1 className="page-title">Your Me² portal is being set up</h1>
          <p className="lede">Thank you for your answers. Your onboarding lead will be in touch with your sign-in details.</p>
        </Card>
      </Frame>
    );
  }
  if (!isEditable(record)) {
    return (
      <Frame>
        <OnboardingSent label={record.label} />
      </Frame>
    );
  }

  return (
    <Frame wide>
      <OnboardingForm token={token} label={record.label} initial={sanitizeAnswers(record.answers)} />
    </Frame>
  );
}

function Frame({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <main data-theme="paper" className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6 sm:py-12">
      <div className={wide ? "mx-auto w-full max-w-5xl" : "mx-auto flex min-h-[70vh] w-full max-w-lg items-center"}>{children}</div>
    </main>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="flex w-full flex-col gap-4 rounded-2xl border bg-card p-7 shadow-[var(--shadow-card)] sm:p-9">{children}</div>;
}
