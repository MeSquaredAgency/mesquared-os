"use client";

import { useActionState } from "react";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signIn, type SignInState } from "@/lib/auth/actions";

export function LoginForm({ next, demoHint }: { next?: string; demoHint?: string }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, {});

  return (
    <form action={action} className="flex flex-col gap-4">
      {next && <input type="hidden" name="next" value={next} />}
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Email
        <Input name="email" type="email" autoComplete="email" required autoFocus placeholder="you@yourcompany.com" defaultValue={state.email ?? ""} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Password
        <Input name="password" type="password" autoComplete="current-password" required />
      </label>
      {state.error && (
        <p role="alert" className="rounded-md bg-red-soft px-3 py-2 text-sm text-red">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="mt-1 h-10">
        <LogIn /> {pending ? "Signing in…" : "Sign in"}
      </Button>
      {demoHint && <p className="text-center text-xs text-muted-foreground">{demoHint}</p>}
    </form>
  );
}
