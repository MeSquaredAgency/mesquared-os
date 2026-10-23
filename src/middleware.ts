import { NextResponse, type NextRequest } from "next/server";
import { getAuthSecret, SESSION_COOKIE } from "@/lib/auth/config";
import { verifySession } from "@/lib/auth/token";

/**
 * Gate the operator dashboard behind a valid session cookie. API routes use
 * per-tenant API keys instead and are not matched here.
 */
export async function middleware(req: NextRequest) {
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value, getAuthSecret());
  const { pathname, search } = req.nextUrl;

  if (pathname === "/login") {
    if (session) return NextResponse.redirect(new URL("/dashboard", req.url));
    return NextResponse.next();
  }

  if (!session) {
    const login = new URL("/login", req.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/login", "/dashboard/:path*", "/marketing/:path*", "/feed/:path*"],
};
