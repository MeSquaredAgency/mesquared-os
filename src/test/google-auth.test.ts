import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { completeGoogleSignIn, createOAuthState, fetchGoogleProfile, googleAuthorizeUrl, googleConfig, googleRedirectUri, verifyOAuthState } from "@/lib/auth/google";

const config = { clientId: "cid.apps.googleusercontent.com", clientSecret: "shh" };
const secret = "unit-test-secret-at-least-16";
const redirectUri = googleRedirectUri("https://app.example.com/");

/** A fake Google: the token endpoint and userinfo, scripted per test. */
function fakeGoogle(profile: Record<string, unknown>, opts: { tokenStatus?: number; sawBody?: (body: URLSearchParams) => void } = {}): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      opts.sawBody?.(new URLSearchParams(String(init?.body)));
      return new Response(JSON.stringify(opts.tokenStatus && opts.tokenStatus >= 400 ? { error: "invalid_grant" } : { access_token: "at_123", id_token: "x" }), { status: opts.tokenStatus ?? 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.startsWith("https://openidconnect.googleapis.com/v1/userinfo")) {
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer at_123");
      return new Response(JSON.stringify(profile), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
}

describe("Google sign-in", () => {
  it("is off until both client values are present, and builds the redirect from the public URL", () => {
    assert.equal(googleConfig({}), null);
    assert.equal(googleConfig({ GOOGLE_OAUTH_CLIENT_ID: "x" }), null);
    assert.deepEqual(googleConfig({ GOOGLE_OAUTH_CLIENT_ID: " x ", GOOGLE_OAUTH_CLIENT_SECRET: "y" }), { clientId: "x", clientSecret: "y" });
    assert.equal(redirectUri, "https://app.example.com/api/auth/google/callback");
  });

  it("sends the browser to Google with the right scopes and a bound state", async () => {
    const state = await createOAuthState(secret, "/console/apn");
    const url = new URL(googleAuthorizeUrl(config, redirectUri, state, "elliot@example.com"));
    assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(url.searchParams.get("client_id"), config.clientId);
    assert.equal(url.searchParams.get("redirect_uri"), redirectUri);
    assert.equal(url.searchParams.get("scope"), "openid email profile");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("state"), state);
    assert.equal(url.searchParams.get("login_hint"), "elliot@example.com");
    assert.equal(url.searchParams.get("prompt"), "select_account");
  });

  it("accepts the state only from the browser that started it, unexpired and untampered", async () => {
    const now = Date.parse("2026-01-15T12:00:00Z");
    const state = await createOAuthState(secret, "/app/apn", now);
    assert.deepEqual(await verifyOAuthState(state, state, secret, now + 60_000), { next: "/app/apn" });
    assert.equal(await verifyOAuthState(state, null, secret, now), null, "no cookie: another browser");
    const other = await createOAuthState(secret, "/app/apn", now);
    assert.equal(await verifyOAuthState(state, other, secret, now), null, "cookie from a different attempt");
    assert.equal(await verifyOAuthState(state, state, "a-different-secret-value", now), null, "wrong secret");
    assert.equal(await verifyOAuthState(state, state, secret, now + 11 * 60_000), null, "expired after ten minutes");
    const tampered = `${state.slice(0, state.indexOf(".") - 2)}zz${state.slice(state.indexOf("."))}`;
    assert.equal(await verifyOAuthState(tampered, tampered, secret, now), null, "tampered payload");
  });

  it("exchanges the code and reads a verified email", async () => {
    let body: URLSearchParams | null = null;
    const profile = await fetchGoogleProfile(config, "code_1", redirectUri, fakeGoogle({ sub: "g1", email: "Director@Harbor.Example", email_verified: true, name: "Dana Reyes" }, { sawBody: (b) => (body = b) }));
    assert.deepEqual(profile, { sub: "g1", email: "director@harbor.example", emailVerified: true, name: "Dana Reyes" });
    assert.equal(body!.get("grant_type"), "authorization_code");
    assert.equal(body!.get("redirect_uri"), redirectUri);
    assert.equal(body!.get("client_secret"), "shh");
    await assert.rejects(() => fetchGoogleProfile(config, "bad", redirectUri, fakeGoogle({}, { tokenStatus: 400 })), /invalid_grant/);
  });

  it("signs in an existing account and nobody else", async () => {
    const now = Date.parse("2026-01-15T12:00:00Z");
    const state = await createOAuthState(secret, "/", now);
    const run = (profile: Record<string, unknown>, extra: Partial<{ code: string | null; state: string | null; cookieState: string | null; error: string | null }> = {}) =>
      completeGoogleSignIn({ code: "code_1", state, cookieState: state, error: null, redirectUri, ...extra }, { config, secret, fetchImpl: fakeGoogle(profile), now });

    const ok = await run({ sub: "g1", email: "director@harbor.example", email_verified: true });
    assert.equal(ok.ok, true);
    assert.equal(ok.ok && ok.user.email, "director@harbor.example");
    assert.equal(ok.ok && ok.next, "/");

    const stranger = await run({ sub: "g2", email: "stranger@gmail.com", email_verified: true });
    assert.deepEqual(stranger, { ok: false, reason: "no_account", next: "/" }, "a Google account with no user here is refused, never created");

    const unverified = await run({ sub: "g1", email: "director@harbor.example", email_verified: false });
    assert.equal(unverified.ok === false && unverified.reason, "unverified");

    const denied = await run({}, { code: null, error: "access_denied" });
    assert.equal(denied.ok === false && denied.reason, "denied");

    const forged = await run({ sub: "g1", email: "director@harbor.example", email_verified: true }, { cookieState: null });
    assert.equal(forged.ok === false && forged.reason, "state", "a callback without the cookie is not trusted");

    const failed = await completeGoogleSignIn({ code: "bad", state, cookieState: state, error: null, redirectUri }, { config, secret, fetchImpl: fakeGoogle({}, { tokenStatus: 400 }), now });
    assert.equal(failed.ok === false && failed.reason, "failed");
  });
});
