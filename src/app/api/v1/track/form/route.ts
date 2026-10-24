import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/data";
import { clientIpFromHeaders } from "@/lib/auth/client-ip";
import { takeIntakeTokens } from "@/lib/intake/rate-limit";
import { redactPayload } from "@/lib/intake/schema";
import { resolveTenantFromRequest } from "@/lib/tenant/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const beacon = z.object({
  _key: z.string().optional(),
  session: z.string().min(8).max(100),
  form: z.string().max(80).optional().nullable(),
  page: z.string().max(500).optional().nullable(),
  fields: z.record(z.string(), z.unknown()).default({}),
});

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Api-Key" };

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

/**
 * POST /api/v1/track/form — a tiny beacon the website calls as someone types
 * into a form (debounced), carrying whatever they have entered so far. If
 * they never submit, the detectors raise an abandoned-form opportunity 30
 * minutes later. Submitting through /api/v1/intake/form with the same
 * `_session` marks the session converted.
 */
export async function POST(req: NextRequest) {
  const parsed = beacon.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid beacon." }, { status: 422, headers: CORS });
  const authReq = parsed.data._key ? new NextRequest(req.url, { headers: { "x-api-key": parsed.data._key } }) : req;
  const auth = await resolveTenantFromRequest(authReq);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status, headers: CORS });
  const limit = takeIntakeTokens([`track:${auth.tenant.id}`, `ip:${clientIpFromHeaders((n) => req.headers.get(n))}`]);
  if (!limit.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: CORS });

  const partial: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(redactPayload(parsed.data.fields) as Record<string, unknown>).slice(0, 20)) {
    if (typeof v === "string" && v.trim() && k.length <= 40 && v !== "[redacted]") partial[k] = v.trim().slice(0, 200);
  }
  if (JSON.stringify(partial).length > 4096) return NextResponse.json({ error: "Too much data." }, { status: 413, headers: CORS });
  await repository.upsertFormSession(auth.tenant.id, { sessionKey: parsed.data.session, formName: parsed.data.form ?? null, pageUrl: parsed.data.page ?? null, partial });
  return NextResponse.json({ ok: true }, { headers: CORS });
}
