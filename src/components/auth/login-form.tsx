"use client";

import { useActionState, useEffect, useRef } from "react";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signIn, type SignInState } from "@/lib/auth/actions";

export function LoginForm({ next, demoHint, googleEnabled = false, notice }: { next?: string; demoHint?: string; googleEnabled?: boolean; notice?: string }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, {});
  const alertRef = useRef<HTMLParagraphElement>(null);

  // After a failed attempt, move focus to the error so it is read out and seen.
  useEffect(() => {
    if (state.error) alertRef.current?.focus();
  }, [state]);

  const invalid = Boolean(state.error);

  const googleHref = `/api/auth/google/start${next ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {notice && (
        <p role="status" className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      {googleEnabled && (
        <>
          <a href={googleHref} className="inline-flex h-11 items-center justify-center gap-2.5 rounded-full border bg-card px-5 text-sm font-medium transition-colors duration-300 hover:border-foreground">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.5 2.9-2.2 5.4-4.7 7.1l7.3 5.7c4.3-4 6.8-9.8 6.8-16.8z" />
              <path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.7 24c0-1.6.3-3.1.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z" />
              <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.3-5.7c-2.1 1.4-4.9 2.3-8.6 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
            </svg>
            Continue with Google
          </a>
          <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />
            or with a password
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}
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
        <p id="signin-error" ref={alertRef} tabIndex={-1} role="alert" className="rounded-lg bg-red-soft px-4 py-3 text-sm text-red-text outline-none">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="mt-1">
        <LogIn /> {pending ? "Signing in…" : "Sign in"}
      </Button>
      {demoHint && <p className="text-center text-xs text-muted-foreground">{demoHint}</p>}
    </form>
  );
}
