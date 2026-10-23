"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { repository } from "@/lib/data";
import { verifyPassword } from "./password";
import { clearFailures, isLocked, recordFailure } from "./rate-limit";
import { clearSessionCookie, createSessionCookie } from "./session";

export interface SignInState {
  error?: string;
  /** Echoed back so the form can keep the email after a failed attempt. */
  email?: string;
}

const credentials = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(1024),
  next: z.string().optional(),
});

/** Only allow same-origin relative paths as a post-login destination. */
function safeNext(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) return { error: "Enter your email address and password.", email: String(formData.get("email") ?? "") };

  const email = parsed.data.email.toLowerCase();
  if (isLocked(email)) {
    return { error: "Too many attempts. Please wait 15 minutes and try again.", email };
  }

  const found = await repository.findUserByEmail(email);
  const ok = found ? await verifyPassword(parsed.data.password, found.passwordHash) : await verifyPassword(parsed.data.password, null);
  if (!found || !ok) {
    recordFailure(email);
    return { error: "That email and password don’t match our records.", email };
  }

  clearFailures(email);
  await createSessionCookie(found.user.id);
  redirect(safeNext(parsed.data.next));
}

export async function signOut() {
  await clearSessionCookie();
  redirect("/login");
}
