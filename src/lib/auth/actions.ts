"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { repository } from "@/lib/data";
import { clientIpFromHeaders } from "./client-ip";
import { hashPasswordSync, verifyPassword } from "./password";
import { clearFailures, delayFor, isLocked, recordFailure } from "./rate-limit";
import { safeNext } from "./redirect";
import { clearSessionCookie, createSessionCookie } from "./session";

export interface SignInState {
  error?: string;
  /** Echoed back so the form can keep the email after a failed attempt. */
  email?: string;
}

const credentials = z.object({
  email: z.string().trim().max(320).pipe(z.email()),
  password: z.string().min(1).max(1024),
  next: z.string().optional(),
});

/**
 * A real hash we verify against when the email is unknown, so a wrong email
 * costs the same scrypt work as a wrong password (no user-enumeration timing).
 */
const DUMMY_HASH = hashPasswordSync("not-a-real-password");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = credentials.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) return { error: "Enter your email address and password.", email: String(formData.get("email") ?? "") };

  const email = parsed.data.email.toLowerCase();
  const h = await headers();
  const ip = clientIpFromHeaders((name) => h.get(name));
  const hardKeys = [`ip:${ip}`, `pair:${ip}:${email}`];
  const softKey = `email:${email}`;

  for (const k of hardKeys) {
    if (await isLocked(k)) return { error: "Too many attempts from this connection. Please wait 15 minutes and try again.", email };
  }
  const delay = await delayFor(softKey);
  if (delay > 0) await sleep(delay);

  const found = await repository.findUserByEmail(email);
  const ok = await verifyPassword(parsed.data.password, found?.passwordHash ?? DUMMY_HASH);
  if (!found || !ok) {
    for (const k of [...hardKeys, softKey]) await recordFailure(k);
    return { error: "That email and password don’t match our records.", email };
  }

  for (const k of [...hardKeys, softKey]) await clearFailures(k);
  await createSessionCookie(found.user);
  redirect(safeNext(parsed.data.next));
}

export async function signOut() {
  await clearSessionCookie();
  redirect("/login");
}
