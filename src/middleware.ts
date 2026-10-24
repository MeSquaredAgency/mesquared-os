import { NextResponse, type NextRequest } from "next/server";
import { getAuthSecret, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, SESSION_TTL_SECONDS, sessionCookieOptions } from "@/lib/auth/config";
import { signSession, verifySession } from "@/lib/auth/token";

/**
 * Gate the operator UI behind a valid session cookie and renew it once it is
 * past half its lifetime (sliding sessions, capped at an absolute max age
 * from the original sign-in). API routes use per-tenant API keys instead.
 * Revocation (sessionVersion) is enforced in `getCurrentUser`, which every
 * protected page calls; middleware only needs the cheap edge-safe checks.
 */
export async function middleware(req: NextRequest) {
  const secret = getAuthSecret();
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value, secret);
  const { pathname, search } = req.nextUrl;

  if (pathname === "/login") {
    if (session) return NextResponse.redirect(new URL("/", req.url));
    return NextResponse.next();
  }

  const now = Math.floor(Date.now() / 1000);
  const tooOld = session ? now - session.iat > SESSION_MAX_AGE_SECONDS : false;
  if (!session || tooOld) {
    const login = new URL("/login", req.url);
    login.searchParams.set("next", `${pathname}${search}`);
    const res = NextResponse.redirect(login);
    if (tooOld) res.cookies.delete(SESSION_COOKIE);
    return res;
  }

  const res = NextResponse.next();
  if (session.exp - now < SESSION_TTL_SECONDS / 2) {
    const exp = Math.min(now + SESSION_TTL_SECONDS, session.iat + SESSION_MAX_AGE_SECONDS);
    const token = await signSession({ ...session, exp }, secret);
    res.cookies.set(SESSION_COOKIE, token, { ...sessionCookieOptions, maxAge: exp - now });
  }
  return res;
}

// Everything is protected except API routes (API-key auth), static assets and the
// two public surfaces leads and customers land on: tracked links (/r/<code>) and the
// booking fallback page (/book/<tenant>). New pages are therefore private by default.
export const config = {
  matcher: ["/((?!api/|_next/|r/|book/|icon\\.svg|favicon\\.ico|robots\\.txt|sitemap\\.xml).*)"],
};
