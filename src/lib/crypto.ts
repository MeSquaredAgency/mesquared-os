import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const API_KEY_PREFIX = "msq_live_";

/** Generates a tenant API key. Only the hash is persisted; the raw key is shown once. */
export function generateApiKey() {
  const raw = `${API_KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  return { raw, hash: hashApiKey(raw), prefix: raw.slice(0, API_KEY_PREFIX.length + 6) };
}

export function hashApiKey(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------------------
// Integration credentials at rest: AES-256-GCM keyed from INTEGRATION_ENCRYPTION_KEY
// ---------------------------------------------------------------------------

import { createCipheriv, createDecipheriv, scryptSync } from "node:crypto";

const KEY_VERSION = "v1";
let cachedKey: Buffer | null = null;

/** Derived once per process; 24+ characters of entropy required outside development. */
function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!raw || raw.length < 24) {
    if (process.env.NODE_ENV === "production") throw new Error("INTEGRATION_ENCRYPTION_KEY must be set (24+ random characters) in production.");
    cachedKey = scryptSync("mesquared-os-dev-integration-key", "msq-dev-salt", 32);
    return cachedKey;
  }
  cachedKey = scryptSync(raw, "msq-integration-salt", 32);
  return cachedKey;
}

/**
 * Encrypts a secret for storage on an Integration row. Output:
 * v1.base64url(iv).base64url(tag).base64url(ciphertext). Pass the row id as
 * `aad` so a ciphertext copied onto another row fails to decrypt.
 */
export function encryptSecret(plain: string, aad?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [KEY_VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), enc.toString("base64url")].join(".");
}

export function decryptSecret(stored: string, aad?: string): string {
  const parts = stored.split(".");
  const [version, iv, tag, data] = parts.length === 4 ? parts : ["v0", ...parts];
  if (!iv || !tag || !data) throw new Error("Malformed encrypted secret.");
  if (version !== KEY_VERSION && version !== "v0") throw new Error(`Unsupported secret version ${version}.`);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
