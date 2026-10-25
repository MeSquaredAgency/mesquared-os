/**
 * Signed session tokens using HMAC-SHA256 over Web Crypto, so the same code
 * verifies in Next.js middleware (edge runtime) and in server components.
 *
 * Format: base64url(payload JSON) + "." + base64url(signature)
 */

export interface SessionPayload {
  /** User id */
  sub: string;
  /** Original sign-in time (unix seconds). Preserved across renewals. */
  iat: number;
  /** Expires at (unix seconds); moves forward on renewal up to the absolute max age. */
  exp: number;
  /** User.sessionVersion at sign-in; a mismatch means the session was revoked. */
  ver: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importKey(secret: string, usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usage);
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await importKey(secret, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  return `${body}.${toBase64Url(sig)}`;
}

/** Returns the payload when the signature is valid and the token is unexpired, else null. */
export async function verifySession(token: string | undefined | null, secret: string, now = Date.now()): Promise<SessionPayload | null> {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sigRaw = token.slice(dot + 1);
  if (!sigRaw) return null;

  let sig: Uint8Array<ArrayBuffer>;
  try {
    sig = fromBase64Url(sigRaw);
  } catch {
    return null;
  }

  const key = await importKey(secret, ["verify"]);
  const valid = await crypto.subtle.verify("HMAC", key, sig, encoder.encode(body));
  if (!valid) return null;

  try {
    const payload = JSON.parse(decoder.decode(fromBase64Url(body))) as Partial<SessionPayload>;
    if (typeof payload.sub !== "string" || typeof payload.exp !== "number" || typeof payload.iat !== "number" || typeof payload.ver !== "number") {
      return null;
    }
    if (payload.exp * 1000 <= now) return null;
    return { sub: payload.sub, iat: payload.iat, exp: payload.exp, ver: payload.ver };
  } catch {
    return null;
  }
}

/** Signs any small JSON payload with an `exp` (unix seconds), same format as a session token. */
export async function signPayload<T extends { exp: number }>(payload: T, secret: string): Promise<string> {
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await importKey(secret, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  return `${body}.${toBase64Url(sig)}`;
}

/** The payload when the signature is valid and `exp` has not passed, else null. */
export async function verifyPayload<T extends { exp: number }>(token: string | undefined | null, secret: string, now = Date.now()): Promise<T | null> {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sigRaw = token.slice(dot + 1);
  if (!sigRaw) return null;
  let sig: Uint8Array<ArrayBuffer>;
  try {
    sig = fromBase64Url(sigRaw);
  } catch {
    return null;
  }
  const key = await importKey(secret, ["verify"]);
  if (!(await crypto.subtle.verify("HMAC", key, sig, encoder.encode(body)))) return null;
  try {
    const payload = JSON.parse(decoder.decode(fromBase64Url(body))) as Partial<T>;
    if (typeof payload.exp !== "number" || payload.exp * 1000 <= now) return null;
    return payload as T;
  } catch {
    return null;
  }
}
