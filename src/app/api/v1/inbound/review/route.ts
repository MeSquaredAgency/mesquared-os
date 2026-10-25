import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { registerContentEngine } from "@/lib/content/engine";
import { repository } from "@/lib/data";
import { emit } from "@/lib/events";
import { resolveTenantFromRequest } from "@/lib/tenant/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reviewSchema = z.object({
  provider: z.string().min(2).max(40),
  externalId: z.string().min(1).max(200),
  authorName: z.string().max(200).optional().nullable(),
  rating: z.number().int().min(1).max(5).optional().nullable(),
  body: z.string().max(5000).optional().nullable(),
  url: z.string().url().regex(/^https?:\/\//i, "http(s) only").optional().nullable(),
  receivedAt: z.string().optional(),
});

/**
 * POST /api/v1/inbound/review — a new public review for the workspace
 * (Google Business Profile, Facebook, a portal). Unanswered reviews become
 * missed opportunities after the tenant's threshold. The Google Business
 * connector will post here itself in Phase 3.
 */
export async function POST(req: NextRequest) {
  registerContentEngine();
  const auth = await resolveTenantFromRequest(req, "webhooks");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const parsed = reviewSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid review payload.", issues: z.flattenError(parsed.error).fieldErrors }, { status: 422 });
  const d = parsed.data;
  const { record, created } = await repository.upsertReview(auth.tenant.id, { provider: d.provider, externalId: d.externalId, authorName: d.authorName ?? null, rating: d.rating ?? null, body: d.body ?? null, url: d.url ?? null, receivedAt: d.receivedAt ? new Date(d.receivedAt) : new Date() });
  if (created) await emit(auth.tenant.id, "review.received", { reviewId: record.id, provider: record.provider, rating: record.rating });
  return NextResponse.json({ received: true, created, reviewId: record.id }, { status: created ? 201 : 200 });
}
