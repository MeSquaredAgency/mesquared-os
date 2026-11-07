import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Chat text at rest: AES-256-GCM under a key used for nothing else. It comes
 * from CHAT_ENCRYPTION_KEY when set, otherwise it is derived from
 * INTEGRATION_ENCRYPTION_KEY with a different salt, so chat is encrypted from
 * the first deploy without a new secret. Each ciphertext is bound to its
 * workspace and message id: copied onto another row, it fails to decrypt.
 *
 * This is encryption at rest, not end-to-end: the server decrypts to show a
 * message to the people allowed to read it.
 */
const VERSION = "c1";
let cached: Buffer | null = null;

function chatKey(): Buffer {
  if (cached) return cached;
  const own = process.env.CHAT_ENCRYPTION_KEY;
  if (own && own.length >= 24) return (cached = scryptSync(own, "msq-chat-salt", 32));
  const shared = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (shared && shared.length >= 24) return (cached = scryptSync(shared, "msq-chat-derived-salt", 32));
  if (process.env.NODE_ENV === "production") throw new Error("INTEGRATION_ENCRYPTION_KEY (or CHAT_ENCRYPTION_KEY) must be set to use the chat in production.");
  return (cached = scryptSync("mesquared-os-dev-chat-key", "msq-dev-salt", 32));
}

/** For tests: forget the derived key after changing the environment. */
export function _resetChatKeyForTests() {
  cached = null;
}

const aadFor = (tenantId: string, messageId: string) => Buffer.from(`chat:${tenantId}:${messageId}`);

export function encryptChatText(text: string, tenantId: string, messageId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", chatKey(), iv);
  cipher.setAAD(aadFor(tenantId, messageId));
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

/** The text, or null when the ciphertext is damaged, from another row, or under a key this deployment does not hold. */
export function decryptChatText(stored: string, tenantId: string, messageId: string): string | null {
  try {
    const [version, iv, tag, data] = stored.split(".");
    if (version !== VERSION || !iv || !tag || !data) return null;
    const decipher = createDecipheriv("aes-256-gcm", chatKey(), Buffer.from(iv, "base64url"));
    decipher.setAAD(aadFor(tenantId, messageId));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
