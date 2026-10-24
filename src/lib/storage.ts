/**
 * Tenant file storage on Neon Object Storage (S3-compatible, bucket "assets"
 * declared in neon.ts). Every key is prefixed with the tenant id and every
 * read goes through a short-lived presigned URL, so nothing is public and a
 * key from one workspace can never be read through another.
 *
 * Configuration comes from the AWS_* variables `neon deploy` writes; with
 * none of them set `isStorageConfigured()` is false and callers degrade.
 */
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { neonServices } from "@/lib/neon";

/** Bucket name as declared under `buckets` in neon.ts. */
export const ASSETS_BUCKET = "assets";
/** Scheme used in `ContentAsset.fileUrl` for objects we hold (as opposed to external links). */
export const STORAGE_URL_PREFIX = `neon-storage://${ASSETS_BUCKET}/`;
const MAX_KEY_LENGTH = 512;

export function isStorageConfigured(): boolean {
  return neonServices().objectStorage;
}

let client: S3Client | null = null;

function s3(): S3Client {
  if (!isStorageConfigured()) throw new Error("Object storage is not configured (AWS_* variables from `neon deploy` are missing).");
  if (!client) {
    client = new S3Client({
      // Neon speaks the S3 API with path-style addressing only.
      forcePathStyle: true,
      endpoint: process.env.AWS_ENDPOINT_URL_S3,
      region: process.env.AWS_REGION || "us-east-1",
      credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID as string, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string },
    });
  }
  return client;
}

function safeSegment(segment: string): string {
  return segment.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^\.+/, "").slice(0, 120);
}

/**
 * Builds the object key for a tenant file: `tenants/<tenantId>/<path>`. Path
 * traversal, empty segments and unusual characters are stripped, so the
 * result always stays inside the tenant's prefix.
 */
export function tenantObjectKey(tenantId: string, path: string): string {
  const segments = path
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s && s !== "." && s !== "..")
    .map(safeSegment)
    .filter(Boolean);
  if (!/^[A-Za-z0-9_-]+$/.test(tenantId)) throw new Error("Invalid tenant id for storage key.");
  if (segments.length === 0) throw new Error("Storage path must contain a file name.");
  const key = `tenants/${tenantId}/${segments.join("/")}`;
  if (key.length > MAX_KEY_LENGTH) throw new Error("Storage path is too long.");
  return key;
}

export function tenantOwnsKey(tenantId: string, key: string): boolean {
  return key.startsWith(`tenants/${tenantId}/`) && !key.includes("..");
}

export function fileUrlFromKey(key: string): string {
  return `${STORAGE_URL_PREFIX}${key}`;
}

/** The object key behind a `ContentAsset.fileUrl`, or null when it is an external link. */
export function storageKeyFromFileUrl(fileUrl: string | null | undefined): string | null {
  if (!fileUrl?.startsWith(STORAGE_URL_PREFIX)) return null;
  const key = fileUrl.slice(STORAGE_URL_PREFIX.length);
  return key.startsWith("tenants/") ? key : null;
}

function assertOwned(tenantId: string, key: string) {
  if (!tenantOwnsKey(tenantId, key)) throw new Error("Object does not belong to this tenant.");
}

export async function putTenantObject(
  tenantId: string,
  path: string,
  body: Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; bytes: number }> {
  const key = tenantObjectKey(tenantId, path);
  const bytes = typeof body === "string" ? Buffer.byteLength(body) : body.byteLength;
  await s3().send(new PutObjectCommand({ Bucket: ASSETS_BUCKET, Key: key, Body: body, ContentType: contentType }));
  return { key, bytes };
}

/** A presigned GET for one of the tenant's objects (default 1 hour). */
export async function getTenantObjectUrl(tenantId: string, key: string, expiresIn = 3600, opts: { inline?: boolean } = {}): Promise<string> {
  assertOwned(tenantId, key);
  // Served as an attachment by default so a stored file is never rendered as a page from the storage origin.
  const filename = key.split("/").pop()?.replace(/[^\w.\-]+/g, "_") || "file";
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: ASSETS_BUCKET, Key: key, ...(opts.inline ? {} : { ResponseContentDisposition: `attachment; filename="${filename}"` }) }), { expiresIn });
}

export async function readTenantObject(tenantId: string, key: string): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  assertOwned(tenantId, key);
  const res = await s3().send(new GetObjectCommand({ Bucket: ASSETS_BUCKET, Key: key }));
  const bytes = (await res.Body?.transformToByteArray()) ?? new Uint8Array();
  return { bytes, contentType: res.ContentType ?? null };
}

export async function deleteTenantObject(tenantId: string, key: string): Promise<void> {
  assertOwned(tenantId, key);
  await s3().send(new DeleteObjectCommand({ Bucket: ASSETS_BUCKET, Key: key }));
}
