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
    const token = await signSession({ sub: "user_1", iat: now, exp: now + 60 }, secret);
    const payload = await verifySession(token, secret);
    assert.equal(payload?.sub, "user_1");
  });

  it("rejects a tampered token, a wrong secret and an expired token", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signSession({ sub: "user_1", iat: now, exp: now + 60 }, secret);
    const [body, sig] = token.split(".");
    assert.equal(await verifySession(`${body}x.${sig}`, secret), null);
    assert.equal(await verifySession(token, "another-secret-entirely"), null);
    const expired = await signSession({ sub: "user_1", iat: now - 120, exp: now - 60 }, secret);
    assert.equal(await verifySession(expired, secret), null);
    assert.equal(await verifySession(undefined, secret), null);
    assert.equal(await verifySession("garbage", secret), null);
  });
});

describe("sign-in rate limiter", () => {
  it("locks after five failures within the window and clears on success", () => {
    _resetRateLimiter();
    for (let i = 0; i < 4; i++) recordFailure("a@b.co");
    assert.equal(isLocked("a@b.co"), false);
    recordFailure("a@b.co");
    assert.equal(isLocked("a@b.co"), true);
    clearFailures("a@b.co");
    assert.equal(isLocked("a@b.co"), false);
  });

  it("expires the window", () => {
    _resetRateLimiter();
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) recordFailure("c@d.co", t0);
    assert.equal(isLocked("c@d.co", t0 + 1000), true);
    assert.equal(isLocked("c@d.co", t0 + 16 * 60_000), false);
  });
});
