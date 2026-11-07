import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { b64url, encryptPayload, fromB64url, generateVapidKeys, sendWebPush, vapidAuthorization } from "@/lib/push/webpush";

const subtle = globalThis.crypto.subtle;

async function ecdhPair(publicKey: string, privateKey: string): Promise<CryptoKeyPair> {
  const pub = fromB64url(publicKey);
  const jwk = { kty: "EC", crv: "P-256", x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33)), d: privateKey, ext: true };
  return {
    privateKey: await subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]),
    publicKey: await subtle.importKey("raw", pub, { name: "ECDH", namedCurve: "P-256" }, true, []),
  };
}

/** What a browser does with the body: an independent decrypt, for the round trip. */
async function decryptAsBrowser(body: Uint8Array, uaPair: CryptoKeyPair, authSecret: Uint8Array): Promise<string> {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ciphertext = body.slice(21 + idlen);
  const uaPublic = new Uint8Array(await subtle.exportKey("raw", uaPair.publicKey));
  const asKey = await subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = await subtle.deriveBits({ name: "ECDH", public: asKey }, uaPair.privateKey, 256);
  const hk = async (s: Uint8Array, ikm: ArrayBuffer | Uint8Array, info: Uint8Array, n: number) => new Uint8Array(await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: s as BufferSource, info: info as BufferSource }, await subtle.importKey("raw", ikm as BufferSource, "HKDF", false, ["deriveBits"]), n * 8));
  const te = new TextEncoder();
  const keyInfo = new Uint8Array([...te.encode("WebPush: info\0"), ...uaPublic, ...asPublic]);
  const ikm = await hk(authSecret, shared, keyInfo, 32);
  const cek = await hk(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hk(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const plain = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonce }, await subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]), ciphertext));
  assert.equal(plain.at(-1), 2, "last-record delimiter");
  return new TextDecoder().decode(plain.slice(0, -1));
}

describe("web push", () => {
  it("matches the worked example in RFC 8291 Appendix A", async () => {
    const asPair = await ecdhPair("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8", "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw");
    const body = await encryptPayload(
      { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" },
      "When I grow up, I want to be a watermelon",
      { ephemeral: asPair, salt: fromB64url("DGv6ra1nlYgDCS1FRnbzlw") },
    );
    assert.equal(b64url(body), "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
  });

  it("round-trips through a browser's decryption with fresh keys every time", async () => {
    const ua = (await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const auth = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const sub = { p256dh: b64url(await subtle.exportKey("raw", ua.publicKey)), auth: b64url(auth) };
    const payload = JSON.stringify({ title: "Alex at Me²", body: "New message — ünïcode" });
    const a = await encryptPayload(sub, payload);
    const b = await encryptPayload(sub, payload);
    assert.notEqual(b64url(a), b64url(b));
    assert.equal(await decryptAsBrowser(a, ua, auth), payload);
    await assert.rejects(encryptPayload({ p256dh: "short", auth: sub.auth }, "x"));
  });

  it("signs a VAPID token the push service can verify, scoped to its origin", async () => {
    const keys = { ...(await generateVapidKeys()), subject: "mailto:ops@mesquared.example" };
    const header = await vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", keys, Date.UTC(2026, 10, 8));
    const [, token, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    assert.equal(k, keys.publicKey);
    const [h, c, sig] = token.split(".");
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(c)));
    assert.equal(claims.aud, "https://fcm.googleapis.com");
    assert.equal(claims.sub, "mailto:ops@mesquared.example");
    assert.equal(claims.exp, Date.UTC(2026, 10, 8) / 1000 + 12 * 3600);
    const pub = await subtle.importKey("raw", fromB64url(keys.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    assert.ok(await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, fromB64url(sig), new TextEncoder().encode(`${h}.${c}`)));
  });

  it("posts the encrypted body with the push headers, and reports a dead subscription", async () => {
    const ua = (await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const sub = { endpoint: "https://push.example/sub/1", p256dh: b64url(await subtle.exportKey("raw", ua.publicKey)), auth: b64url(new Uint8Array(16)) };
    const keys = { ...(await generateVapidKeys()), subject: "mailto:x@example.com" };
    let seen: RequestInit | undefined;
    const ok = await sendWebPush(sub, "{}", keys, { urgency: "high", fetchImpl: (async (_u: string, init: RequestInit) => ((seen = init), new Response(null, { status: 201 }))) as unknown as typeof fetch });
    assert.deepEqual(ok, { ok: true, status: 201, gone: false });
    const headers = seen!.headers as Record<string, string>;
    assert.equal(headers["Content-Encoding"], "aes128gcm");
    assert.equal(headers.Urgency, "high");
    assert.match(headers.Authorization, /^vapid t=/);
    const gone = await sendWebPush(sub, "{}", keys, { fetchImpl: (async () => new Response(null, { status: 410 })) as unknown as typeof fetch });
    assert.equal(gone.gone, true);
  });
});

describe("notifications", async () => {
  const { repository } = await import("@/lib/data");
  const { demoTenants } = await import("@/lib/data/fixtures");
  const { isPushEndpoint, pushToPeople } = await import("@/lib/push");
  const { postChatMessage } = await import("@/lib/chat");
  const harbor = demoTenants[0];

  async function device(userId: string, endpoint: string) {
    const ua = (await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    return repository.savePushSubscription(userId, { endpoint, p256dh: b64url(await subtle.exportKey("raw", ua.publicKey)), auth: b64url(globalThis.crypto.getRandomValues(new Uint8Array(16))), device: "Test" });
  }

  async function withFetch<T>(status: number, fn: (calls: string[]) => Promise<T>): Promise<T> {
    const original = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL) => (calls.push(String(url)), new Response(null, { status }))) as typeof fetch;
    try {
      return await fn(calls);
    } finally {
      globalThis.fetch = original;
    }
  }

  it("only accepts the browsers' own push services", () => {
    assert.ok(isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc"));
    assert.ok(isPushEndpoint("https://web.push.apple.com/QGx"));
    assert.ok(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x"));
    assert.ok(!isPushEndpoint("http://fcm.googleapis.com/x"), "https only");
    assert.ok(!isPushEndpoint("https://evil.example.com/collect"));
    assert.ok(!isPushEndpoint("https://googleapis.com.evil.net/x"));
    assert.ok(!isPushEndpoint("not a url"));
  });

  it("reaches every device a person has, and forgets one the service says is gone", async () => {
    await device("u_push_a", "https://fcm.googleapis.com/fcm/send/a1");
    await device("u_push_a", "https://web.push.apple.com/a2");
    const reached = await withFetch(201, async (calls) => {
      const r = await pushToPeople(["u_push_a", "u_nobody"], { title: "t", body: "b", url: "/x" });
      assert.equal(calls.length, 2);
      return r;
    });
    assert.deepEqual([...reached], ["u_push_a"]);
    await withFetch(410, () => pushToPeople(["u_push_a"], { title: "t", body: "b", url: "/x" }));
    assert.deepEqual(await repository.listPushSubscriptions(["u_push_a"]), []);
  });

  it("sends a chat notification to the other side's devices and emails only the people without one", async () => {
    const people = await repository.listTenantPeople(harbor.id);
    const members = people.filter((p) => p.via === "member" && (p.permissions.includes("MANAGE_USERS") || p.permissions.includes("VIEW_FINANCES")));
    assert.ok(members.length >= 1);
    await device(members[0].userId, "https://fcm.googleapis.com/fcm/send/member0");
    const prev = { mode: process.env.MESSAGING_MODE, from: process.env.DEFAULT_FROM_EMAIL };
    process.env.MESSAGING_MODE = "log";
    process.env.DEFAULT_FROM_EMAIL = "os@mesquared.example";
    const lines: string[] = [];
    const info = console.info;
    console.info = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
    try {
      await withFetch(201, async (calls) => {
        await postChatMessage({ tenant: harbor, authorId: "op_push", authorName: "Alex", side: "ME2", text: "Ads are live" });
        assert.ok(calls.includes("https://fcm.googleapis.com/fcm/send/member0"), "pushed to the member's phone");
      });
      const emails = lines.filter((l) => l.includes("[messaging:log]") && l.includes("EMAIL"));
      assert.ok(emails.every((l) => !l.includes(members[0].email)), "nobody with a device is emailed");
      assert.equal(emails.length, members.length - 1);
    } finally {
      console.info = info;
      for (const [k, v] of [["MESSAGING_MODE", prev.mode], ["DEFAULT_FROM_EMAIL", prev.from]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
