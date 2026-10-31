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
    <main data-theme="paper" className="grid min-h-screen bg-background text-foreground lg:grid-cols-[1fr_1fr]">
      <aside data-theme="abyss" className="relative hidden overflow-hidden bg-background text-foreground lg:flex lg:flex-col lg:justify-between lg:p-12">
        <Motif className="absolute -top-8 right-0 w-[400px]" />
        <BrandMark tone="abyss" className="relative h-7 self-start" />
        <div className="relative flex max-w-lg flex-col gap-5">
          <p className="eyebrow">MeSquared OS</p>
          <p className="display">We run the back office. You run the business.</p>
          <p className="max-w-md text-md text-muted-foreground">What needs you, what we handled, and what we won back. One place, with a person checking the work.</p>
        </div>
        <p className="relative text-xs text-muted-foreground">People, backed by AI.</p>
      </aside>
      <div className="flex items-center justify-center px-5 py-12 lg:px-16">
        <div className="w-full max-w-sm">
          <BrandMark tone="paper" className="mb-10 h-6 lg:hidden" />
          <h1 className="page-title">Sign in</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">Your business, squared.</p>
          <div className="mt-7">
            <LoginForm next={next} demoHint={demoHint} googleEnabled={googleEnabled} notice={notice} />
          </div>
        </div>
      </div>
    </main>
  );
}
