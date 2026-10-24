import { NextResponse, type NextRequest } from "next/server";
import { repository } from "@/lib/data";
import { getTenantObjectUrl, isStorageConfigured, storageKeyFromFileUrl } from "@/lib/storage";
import { resolveTenantFromRequest } from "@/lib/tenant/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const URL_TTL_SECONDS = 600;

/**
 * GET /api/v1/assets/:id — fetch a content asset's file. Redirects to a
 * ten-minute presigned URL (`?format=json` returns it instead). The asset
 * must belong to the tenant the API key resolves to.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveTenantFromRequest(req, "content");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  const asset = await repository.findContentAssetById(auth.tenant.id, id);
  const key = storageKeyFromFileUrl(asset?.fileUrl);
  if (!asset || !key) return NextResponse.json({ error: "No such file in this workspace." }, { status: 404 });
  if (!isStorageConfigured()) return NextResponse.json({ error: "Object storage is not configured for this deployment." }, { status: 503 });
  const url = await getTenantObjectUrl(auth.tenant.id, key, URL_TTL_SECONDS);
  if (req.nextUrl.searchParams.get("format") === "json") {
    return NextResponse.json({ id: asset.id, title: asset.title, kind: asset.kind, url, urlExpiresInSeconds: URL_TTL_SECONDS });
  }
  return NextResponse.redirect(url, 302);
}
