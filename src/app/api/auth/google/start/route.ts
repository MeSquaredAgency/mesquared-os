import { NextResponse, type NextRequest } from "next/server";
import { getAuthSecret, sessionCookieOptions } from "@/lib/auth/config";
import { createOAuthState, googleAuthorizeUrl, googleConfig, googleRedirectUri, OAUTH_STATE_COOKIE, OAUTH_STATE_TTL_SECONDS } from "@/lib/auth/google";
import { safeNext } from "@/lib/auth/redirect";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/auth/google/start?next=/path — sends the browser to Google with a signed, cookie-bound state. */
export async function GET(req: NextRequest) {
  const config = googleConfig();
  if (!config) return NextResponse.redirect(new URL("/login?error=unavailable", req.url));
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  const state = await createOAuthState(getAuthSecret(), next);
  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || req.nextUrl.origin;
  const res = NextResponse.redirect(googleAuthorizeUrl(config, googleRedirectUri(origin), state, req.nextUrl.searchParams.get("hint")));
  res.cookies.set(OAUTH_STATE_COOKIE, state, { ...sessionCookieOptions, maxAge: OAUTH_STATE_TTL_SECONDS });
  return res;
}
