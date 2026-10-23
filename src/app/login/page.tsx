import { LoginForm } from "@/components/auth/login-form";
import { dataMode } from "@/lib/data";
import { DEMO_ACCOUNTS } from "@/lib/data/fixtures";

export const metadata = { title: "Sign in" };

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const demoHint =
    dataMode === "demo" && process.env.NODE_ENV !== "production"
      ? `Demo mode. Any of these sign in with DEMO_OPERATOR_PASSWORD (default "mesquared-demo"): ${DEMO_ACCOUNTS.map((a) => a.email).join(", ")}.`
      : undefined;

  return (
    <main className="flex min-h-screen items-center justify-center bg-sidebar p-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-xs">
        <div className="mb-6 flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">M²</span>
          <div className="leading-tight">
            <p className="text-sm font-semibold">MeSquared OS</p>
            <p className="text-xs text-muted-foreground">Operator sign-in</p>
          </div>
        </div>
        <LoginForm next={next} demoHint={demoHint} />
      </div>
    </main>
  );
}
