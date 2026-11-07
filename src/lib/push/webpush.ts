/**
 * Web Push with nothing but Web Crypto, so it runs the same on Cloudflare
 * Workers and in Node: the payload is encrypted for the browser (RFC 8291,
 * aes128gcm) and the request is signed for the push service (RFC 8292,
 * VAPID). The push service only ever sees ciphertext.
 */

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(value: string): Uint8Array<ArrayBuffer> {
  const s = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource }, key, bytes * 8));
}

export interface PushSubscriptionKeys {
  endpoint: string;
  /** The browser's P-256 public key, uncompressed, base64url. */
  p256dh: string;
  /** The browser's 16-byte auth secret, base64url. */
  auth: string;
}

/**
 * Encrypts a payload for one subscription (RFC 8291). `ephemeral` and `salt`
 * are only for tests; real calls get fresh ones every time.
 */
export async function encryptPayload(sub: Pick<PushSubscriptionKeys, "p256dh" | "auth">, payload: string, test?: { ephemeral?: CryptoKeyPair; salt?: Uint8Array }): Promise<Uint8Array> {
  const uaPublic = fromB64url(sub.p256dh);
  const authSecret = fromB64url(sub.auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error("Malformed push subscription keys.");
  const ephemeral = test?.ephemeral ?? ((await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair);
  const asPublic = new Uint8Array(await subtle.exportKey("raw", ephemeral.publicKey));
  const uaKey = await subtle.importKey("raw", uaPublic as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: uaKey }, ephemeral.privateKey, 256));

  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = test?.salt ?? globalThis.crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const plaintext = concat(enc.encode(payload), new Uint8Array([2]));
  const key = await subtle.importKey("raw", cek as BufferSource, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce as BufferSource }, key, plaintext as BufferSource));

  const recordSize = 4096;
  if (plaintext.length + 16 > recordSize) throw new Error("Push payload too large.");
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, recordSize);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

export interface VapidKeys {
  /** Uncompressed P-256 public key, base64url (65 bytes): what browsers subscribe with. */
  publicKey: string;
  /** The private scalar d, base64url (32 bytes). */
  privateKey: string;
  /** A mailto: or https: contact for the push services. */
  subject: string;
}

/** The Authorization header value for a push service (RFC 8292). */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now()): Promise<string> {
  const pub = fromB64url(keys.publicKey);
  if (pub.length !== 65) throw new Error("VAPID public key must be an uncompressed P-256 point.");
  const jwk: JsonWebKey = { kty: "EC", crv: "P-256", x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), d: keys.privateKey, ext: true };
  const key = await subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: keys.subject })));
  const signature = await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${keys.publicKey}`;
}

export interface PushSendResult {
  ok: boolean;
  status: number;
  /** The subscription is dead (expired or revoked): forget it. */
  gone: boolean;
}

/** Sends one encrypted push. Times out after ten seconds rather than holding up the caller. */
export async function sendWebPush(sub: PushSubscriptionKeys, payload: string, keys: VapidKeys, opts: { ttlSeconds?: number; urgency?: "very-low" | "low" | "normal" | "high"; topic?: string; fetchImpl?: typeof fetch } = {}): Promise<PushSendResult> {
  const body = await encryptPayload(sub, payload);
  const res = await (opts.fetchImpl ?? fetch)(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(sub.endpoint, keys),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(opts.ttlSeconds ?? 24 * 3600),
      Urgency: opts.urgency ?? "normal",
      ...(opts.topic ? { Topic: opts.topic } : {}),
    },
    body: body as BodyInit,
    signal: AbortSignal.timeout(10_000),
  });
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
}

/** A fresh VAPID key pair, as stored in VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY. */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = (await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = await subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: b64url(await subtle.exportKey("raw", pair.publicKey)), privateKey: jwk.d! };
}
