import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { repository } from "@/lib/data";
import type { UserRecord } from "@/lib/types";
import { getAuthSecret, SESSION_COOKIE, SESSION_TTL_SECONDS, sessionCookieOptions } from "./config";
import { signSession, verifySession } from "./token";

export async function createSessionCookie(user: Pick<UserRecord, "id" | "sessionVersion">) {
  const now = Math.floor(Date.now() / 1000);
  const token = await signSession({ sub: user.id, iat: now, exp: now + SESSION_TTL_SECONDS, ver: user.sessionVersion }, getAuthSecret());
  const store = await cookies();
  store.set(SESSION_COOKIE, token, { ...sessionCookieOptions, maxAge: SESSION_TTL_SECONDS });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * The signed-in user for this request, or null. Besides the signature and
 * expiry (also checked in middleware), this confirms the user still exists
 * and the session has not been revoked by a sessionVersion bump.
 */
export async function getCurrentUser(): Promise<UserRecord | null> {
  const store = await cookies();
  const payload = await verifySession(store.get(SESSION_COOKIE)?.value, getAuthSecret());
  if (!payload) return null;
  const user = await repository.findUserById(payload.sub);
  if (!user || user.sessionVersion !== payload.ver) return null;
  return user;
}

/** Like getCurrentUser, but redirects to the login page when nobody is signed in. */
export async function requireUser(nextPath?: string): Promise<UserRecord> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login");
  }
  return user;
}
