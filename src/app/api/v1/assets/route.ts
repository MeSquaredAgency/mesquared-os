import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { repository } from "@/lib/data";
import { emit } from "@/lib/events";
import { takeIntakeToken } from "@/lib/intake/rate-limit";
import { fileUrlFromKey, getTenantObjectUrl, isStorageConfigured, putTenantObject } from "@/lib/storage";
import { resolveTenantFromRequest } from "@/lib/tenant/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;
const URL_TTL_SECONDS = 3600;

function kindFor(contentType: string): "IMAGE" | "RAW_VIDEO" | "RAW_AUDIO" | "RAW_TEXT" {
  if (contentType.startsWith("image/")) return "IMAGE";
  if (contentType.startsWith("video/")) return "RAW_VIDEO";
  if (contentType.startsWith("audio/")) return "RAW_AUDIO";
  return "RAW_TEXT";
}

/**
 * POST /api/v1/assets — upload a file into the workspace's content library.
 *
 * Multipart form: `file` (required, ≤ 10 MB) and optional `title`. The object
 * is stored on Neon Object Storage under the tenant's prefix, a ContentAsset
 * row points at it, and the response carries a one-hour presigned URL.
 * Authenticated with the tenant API key like the intake endpoint.
 */
export async function POST(req: NextRequest) {
  const auth = await resolveTenantFromRequest(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { tenant } = auth;
  if (!isStorageConfigured()) return NextResponse.json({ error: "Object storage is not configured for this deployment." }, { status: 503 });

  const limit = takeIntakeToken(`assets:${tenant.id}`);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many uploads. Try again shortly." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });
  }
  const declared = Number.parseInt(req.headers.get("content-length") ?? "0", 10);
  if (declared > MAX_BYTES + 64 * 1024) return NextResponse.json({ error: "File is larger than 10 MB." }, { status: 413 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof Blob)) return NextResponse.json({ error: "Send multipart form data with a `file` field." }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "The file is empty." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File is larger than 10 MB." }, { status: 413 });

  const name = ("name" in file && typeof file.name === "string" && file.name) || "upload";
  const contentType = file.type || "application/octet-stream";
  const title = String(form.get("title") ?? "").trim().slice(0, 200) || name;

  const { key, bytes } = await putTenantObject(tenant.id, `content/${randomUUID()}/${name}`, new Uint8Array(await file.arrayBuffer()), contentType);
  const [asset] = await repository.createContentAssets(tenant.id, [
    { kind: kindFor(contentType), title, body: null, targetPlatform: null, status: "DRAFT", needsClientSignoff: false, tags: [], scheduledFor: null, fileUrl: fileUrlFromKey(key) },
  ]);
  await emit(tenant.id, "content.uploaded", { assetId: asset.id, kind: asset.kind, bytes, contentType });
  const url = await getTenantObjectUrl(tenant.id, key, URL_TTL_SECONDS);

  return NextResponse.json(
    {
      asset: { id: asset.id, kind: asset.kind, title: asset.title, status: asset.status, createdAt: asset.createdAt },
      file: { key, bytes, contentType },
      url,
      urlExpiresInSeconds: URL_TTL_SECONDS,
    },
    { status: 201 },
  );
}
