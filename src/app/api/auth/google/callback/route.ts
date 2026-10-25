import { NextResponse, type NextRequest } from "next/server";
import { clientIpFromHeaders } from "@/lib/auth/client-ip";
import { getAuthSecret } from "@/lib/auth/config";
import { completeGoogleSignIn, googleConfig, googleRedirectUri, OAUTH_STATE_COOKIE } from "@/lib/auth/google";
import { createSessionCookie } from "@/lib/auth/session";
import { takeIntakeTokens } from "@/lib/intake/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/google/callback — Google returns here; an existing account gets a session, anyone else a reason. */
export async function GET(req: NextRequest) {
  const config = googleConfig();
  if (!config) return NextResponse.redirect(new URL("/login?error=unavailable", req.url));

  const limit = await takeIntakeTokens([`oauth:${clientIpFromHeaders((n) => req.headers.get(n))}`]);
  if (!limit.allowed) return NextResponse.redirect(new URL("/login?error=failed", req.url));

  const params = req.nextUrl.searchParams;
  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || req.nextUrl.origin;
  const result = await completeGoogleSignIn(
    { code: params.get("code"), state: params.get("state"), cookieState: req.cookies.get(OAUTH_STATE_COOKIE)?.value ?? null, error: params.get("error"), redirectUri: googleRedirectUri(origin) },
    { config, secret: getAuthSecret() },
  );

  if (!result.ok) {
    const login = new URL("/login", req.url);
    login.searchParams.set("error", result.reason);
    if (result.next && result.next !== "/") login.searchParams.set("next", result.next);
    const res = NextResponse.redirect(login);
    res.cookies.delete(OAUTH_STATE_COOKIE);
    return res;
  }

  await createSessionCookie(result.user);
  const res = NextResponse.redirect(new URL(result.next, req.url));
  res.cookies.delete(OAUTH_STATE_COOKIE);
  return res;
}
