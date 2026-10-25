import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hashPassword, hashPasswordSync, verifyPassword } from "../lib/auth/password.ts";
import { signSession, verifySession } from "../lib/auth/token.ts";
import { _resetRateLimiter, clearFailures, isLocked, recordFailure } from "../lib/auth/rate-limit.ts";

describe("passwords", () => {
  it("verifies a hashed password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse battery staple");
    assert.ok(hash.startsWith("scrypt$"));
    assert.equal(await verifyPassword("correct horse battery staple", hash), true);
    assert.equal(await verifyPassword("wrong", hash), false);
  });

  it("sync and async variants are interchangeable", async () => {
    const hash = hashPasswordSync("pw");
    assert.equal(await verifyPassword("pw", hash), true);
  });

  it("rejects empty or malformed hashes", async () => {
    assert.equal(await verifyPassword("pw", null), false);
    assert.equal(await verifyPassword("pw", "bcrypt$nope"), false);
    assert.equal(await verifyPassword("pw", "scrypt$abc"), false);
  });
});

describe("session tokens", () => {
  const secret = "test-secret-that-is-long-enough";

  it("round-trips a payload", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signSession({ sub: "user_1", iat: now, exp: now + 60, ver: 0 }, secret);
    const payload = await verifySession(token, secret);
    assert.equal(payload?.sub, "user_1");
  });

  it("rejects a tampered token, a wrong secret and an expired token", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signSession({ sub: "user_1", iat: now, exp: now + 60, ver: 0 }, secret);
    const [body, sig] = token.split(".");
    assert.equal(await verifySession(`${body}x.${sig}`, secret), null);
    assert.equal(await verifySession(token, "another-secret-entirely"), null);
    const expired = await signSession({ sub: "user_1", iat: now - 120, exp: now - 60, ver: 0 }, secret);
    assert.equal(await verifySession(expired, secret), null);
    assert.equal(await verifySession(undefined, secret), null);
    assert.equal(await verifySession("garbage", secret), null);
  });
});

describe("sign-in rate limiter", () => {
  it("locks after five failures within the window and clears on success", async () => {
    _resetRateLimiter();
    for (let i = 0; i < 4; i++) await recordFailure("a@b.co");
    assert.equal(await isLocked("a@b.co"), false);
    await recordFailure("a@b.co");
    assert.equal(await isLocked("a@b.co"), true);
    await clearFailures("a@b.co");
    assert.equal(await isLocked("a@b.co"), false);
  });

  it("expires the window", async () => {
    _resetRateLimiter();
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) await recordFailure("c@d.co", t0);
    assert.equal(await isLocked("c@d.co", t0 + 1000), true);
    assert.equal(await isLocked("c@d.co", t0 + 16 * 60_000), false);
  });
});

describe("sign-in rate limiter: progressive delay", () => {
  it("grows the delay per failure and caps it", async () => {
    const { _resetRateLimiter, delayFor, recordFailure } = await import("../lib/auth/rate-limit.ts");
    _resetRateLimiter();
    assert.equal(await delayFor("email:x@y.z"), 0);
    await recordFailure("email:x@y.z");
    assert.equal(await delayFor("email:x@y.z"), 500);
    await recordFailure("email:x@y.z");
    assert.equal(await delayFor("email:x@y.z"), 1000);
    for (let i = 0; i < 10; i++) await recordFailure("email:x@y.z");
    assert.equal(await delayFor("email:x@y.z"), 4000);
  });
});

describe("client ip", () => {
  it("prefers platform headers, then the nearest trusted hop of x-forwarded-for", async () => {
    const { clientIpFromHeaders } = await import("../lib/auth/client-ip.ts");
    const headers = (map: Record<string, string>) => (name: string) => map[name] ?? null;
    assert.equal(clientIpFromHeaders(headers({ "cf-connecting-ip": "1.1.1.1", "x-forwarded-for": "9.9.9.9" })), "1.1.1.1");
    assert.equal(clientIpFromHeaders(headers({ "x-forwarded-for": "spoofed, 2.2.2.2" })), "2.2.2.2");
    assert.equal(clientIpFromHeaders(headers({ "x-real-ip": "3.3.3.3" })), "3.3.3.3");
    assert.equal(clientIpFromHeaders(headers({})), "unknown");
  });
});
