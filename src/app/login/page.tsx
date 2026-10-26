import { LoginForm } from "@/components/auth/login-form";
import { BrandMark } from "@/components/shell/app-shell";
import { Motif } from "@/components/shell/hero";
import { GOOGLE_SIGN_IN_MESSAGES, googleConfig } from "@/lib/auth/google";
import { dataMode } from "@/lib/data";
import { DEMO_ACCOUNTS } from "@/lib/data/fixtures";

export const metadata = { title: "Sign in" };

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const googleEnabled = googleConfig() !== null;
  const notice = error && error in GOOGLE_SIGN_IN_MESSAGES ? GOOGLE_SIGN_IN_MESSAGES[error as keyof typeof GOOGLE_SIGN_IN_MESSAGES] : undefined;
  const demoHint =
    dataMode === "demo" && process.env.NODE_ENV !== "production"
      ? `Demo mode. Any of these sign in with DEMO_OPERATOR_PASSWORD (default "mesquared-demo"): ${DEMO_ACCOUNTS.map((a) => a.email).join(", ")}.`
      : undefined;

  return (
    <main data-theme="paper" className="grid min-h-screen bg-background text-foreground lg:grid-cols-[1.1fr_1fr]">
      <aside data-theme="abyss" className="panel-dark relative hidden overflow-hidden text-foreground lg:flex lg:flex-col lg:justify-between lg:p-14">
        <Motif className="absolute -top-6 right-0 w-[420px]" />
        <BrandMark tone="abyss" className="relative h-8 self-start" />
        <div className="relative flex max-w-xl flex-col gap-5">
          <p className="kicker">MeSquared OS</p>
          <h2 className="display">We run the back office. You run the business.</h2>
          <p className="lede">What needs you, what we handled, and what we won back. One place, with a person checking the work.</p>
        </div>
      </aside>
      <div className="flex items-center justify-center px-5 py-12 lg:px-16">
        <div className="w-full max-w-sm">
          <BrandMark tone="paper" className="mb-10 h-7 lg:hidden" />
          <h1 className="page-title">Sign in</h1>
          <p className="lede mt-2 text-base">Your business, squared.</p>
          <div className="mt-8">
            <LoginForm next={next} demoHint={demoHint} googleEnabled={googleEnabled} notice={notice} />
          </div>
        </div>
      </div>
    </main>
  );
}
