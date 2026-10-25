import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { clientIpFromHeaders } from "@/lib/auth/client-ip";
import { generateFromSource, ingestSource, registerContentEngine } from "@/lib/content/engine";
import { takeIntakeTokens } from "@/lib/intake/rate-limit";
import { resolveTenantFromRequest } from "@/lib/tenant/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  title: z.string().trim().min(2).max(200),
  body: z.string().trim().min(20).max(20_000),
  /** Draft straight away (default) or just file the material for the daily batch. */
  generate: z.boolean().default(true),
  platforms: z.array(z.enum(["FACEBOOK", "INSTAGRAM", "TIKTOK", "YOUTUBE", "LINKEDIN", "GOOGLE_BUSINESS"])).max(6).optional(),
});

/**
 * POST /api/v1/content/sources — push source material in (a note from a
 * phone, an email, a Zapier step). Needs an API key with the "content" scope;
 * the public intake key is refused. Returns the source and any drafts.
 */
export async function POST(req: NextRequest) {
  registerContentEngine();
  const auth = await resolveTenantFromRequest(req, "content");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const limit = await takeIntakeTokens([`content:${auth.tenant.id}`, `ip:${clientIpFromHeaders((n) => req.headers.get(n))}`]);
  if (!limit.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload.", issues: z.flattenError(parsed.error).fieldErrors }, { status: 422 });
  const source = await ingestSource(auth.tenant, { kind: "RAW_TEXT", title: parsed.data.title, body: parsed.data.body, origin: "api" });
  const result = parsed.data.generate ? await generateFromSource(auth.tenant, source.id, { platforms: parsed.data.platforms }) : { drafts: [], skipped: null };
  return NextResponse.json({ source: { id: source.id, title: source.title }, drafts: result.drafts.map((d) => ({ id: d.id, platform: d.targetPlatform, title: d.title, status: d.status, needsClientSignoff: d.needsClientSignoff })), skipped: result.skipped }, { status: 201 });
}
