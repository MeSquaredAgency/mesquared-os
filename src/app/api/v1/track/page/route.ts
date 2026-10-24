import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { clientIpFromHeaders } from "@/lib/auth/client-ip";
import { repository } from "@/lib/data";
import { takeIntakeTokens } from "@/lib/intake/rate-limit";
import { resolveTenantFromRequest } from "@/lib/tenant/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Api-Key" };

const schema = z.object({
  kind: z.enum(["PAGEVIEW", "FORM_START", "FORM_SUBMIT", "LINK_CLICK"]).default("PAGEVIEW"),
  path: z.string().max(300).optional().nullable(),
  referrer: z.string().max(500).optional().nullable(),
  /** utm_source from the page's query string, if any. */
  source: z.string().max(100).optional().nullable(),
  /** A random per-browser-session id the snippet keeps in sessionStorage. */
  session: z.string().max(80).optional().nullable(),
});

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * POST /api/v1/track/page — the website beacon. One small request per page
 * view (plus form starts) from a snippet on the tenant's site, with the
 * intake key. No cookies, no fingerprinting: a session id the browser makes
 * up and forgets when the tab closes.
 */
export async function POST(req: NextRequest) {
  const auth = await resolveTenantFromRequest(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: CORS });
  const limit = takeIntakeTokens([`page:${auth.tenant.id}`, `ip:${clientIpFromHeaders((n) => req.headers.get(n))}`]);
  if (!limit.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: CORS });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid beacon." }, { status: 422, headers: CORS });
  const d = parsed.data;
  let path = d.path ?? null;
  try {
    if (path && /^https?:\/\//.test(path)) path = new URL(path).pathname;
  } catch {}
  await repository.recordWebEvents(auth.tenant.id, [{ kind: d.kind, path: path?.slice(0, 300) ?? null, referrer: d.referrer ?? req.headers.get("referer"), source: d.source?.toLowerCase() ?? null, sessionKey: d.session ?? null }]);
  return NextResponse.json({ ok: true }, { headers: CORS });
}
