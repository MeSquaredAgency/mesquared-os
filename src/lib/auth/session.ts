import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { repository } from "@/lib/data";
import type { UserRecord } from "@/lib/types";
import { getAuthSecret, SESSION_COOKIE, SESSION_TTL_SECONDS } from "./config";
import { signSession, verifySession } from "./token";

export async function createSessionCookie(userId: string) {
  const now = Math.floor(Date.now() / 1000);
  const token = await signSession({ sub: userId, iat: now, exp: now + SESSION_TTL_SECONDS }, getAuthSecret());
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** The signed-in user for this request, or null. */
export async function getCurrentUser(): Promise<UserRecord | null> {
  const store = await cookies();
  const payload = await verifySession(store.get(SESSION_COOKIE)?.value, getAuthSecret());
  if (!payload) return null;
  return repository.findUserById(payload.sub);
}

/** Like getCurrentUser, but redirects to the login page when nobody is signed in. */
export async function requireUser(nextPath?: string): Promise<UserRecord> {
  const user = await getCurrentUser();
  if (!user) {
    const target = nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login";
    redirect(target);
  }
  return user;
}
