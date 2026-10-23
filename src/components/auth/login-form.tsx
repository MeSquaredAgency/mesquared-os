"use client";

import { useActionState, useEffect, useRef } from "react";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signIn, type SignInState } from "@/lib/auth/actions";

export function LoginForm({ next, demoHint }: { next?: string; demoHint?: string }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, {});
  const alertRef = useRef<HTMLParagraphElement>(null);

  // After a failed attempt, move focus to the error so it is read out and seen.
  useEffect(() => {
    if (state.error) alertRef.current?.focus();
  }, [state]);

  const invalid = Boolean(state.error);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {next && <input type="hidden" name="next" value={next} />}
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Email
        <Input
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus={!invalid}
          placeholder="you@yourcompany.com"
          defaultValue={state.email ?? ""}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? "signin-error" : undefined}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Password
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? "signin-error" : undefined}
        />
      </label>
      {state.error && (
        <p id="signin-error" ref={alertRef} tabIndex={-1} role="alert" className="rounded-md bg-red-soft px-3 py-2 text-sm text-red-text outline-none">
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
