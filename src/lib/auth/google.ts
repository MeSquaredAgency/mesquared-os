import { repository } from "@/lib/data";
import type { UserRecord } from "@/lib/types";
import { signPayload, verifyPayload } from "./token";

/**
 * "Continue with Google" for people who already have an account here.
 *
 * Google only proves who someone is; it never creates an account. The email
 * Google reports (verified by Google) must match an existing user, which is
 * how a Me² operator or a client member gets in without a password. Tenant
 * membership is unchanged: Google sign-in grants exactly what a password
 * sign-in to the same account would.
 *
 * The flow is the standard authorisation-code flow. The `state` parameter is
 * a short-lived signed token that also travels in a cookie, so a callback is
 * only accepted from the browser that started it. Everything here is free of
 * next/* so it can be tested directly; the two route handlers are thin.
 */

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
export const OAUTH_STATE_COOKIE = "msq_oauth_state";
/** How long a sign-in attempt may take between leaving for Google and coming back. */
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
}

/** The platform's Google OAuth client, shared with the Google Ads and Business Profile connectors. */
export function googleConfig(env: Record<string, string | undefined> = process.env): GoogleConfig | null {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Where Google sends the browser back; registered on the OAuth client in Google Cloud. */
export function googleRedirectUri(origin: string): string {
  return `${origin.replace(/\/$/, "")}/api/auth/google/callback`;
}

interface OAuthState {
  /** Random nonce; the cookie and the state parameter must carry the same token. */
  n: string;
  /** Where to send the person after sign-in (already passed through safeNext). */
  next: string;
  exp: number;
}

export async function createOAuthState(secret: string, next: string, now = Date.now()): Promise<string> {
  const nonce = toBase64Url(crypto.getRandomValues(new Uint8Array(24)));
  return signPayload<OAuthState>({ n: nonce, next, exp: Math.floor(now / 1000) + OAUTH_STATE_TTL_SECONDS }, secret);
}

/** The state is valid when it verifies, is unexpired, and is exactly the token the cookie holds. */
export async function verifyOAuthState(stateParam: string | null | undefined, cookieValue: string | null | undefined, secret: string, now = Date.now()): Promise<{ next: string } | null> {
  if (!stateParam || !cookieValue || stateParam !== cookieValue) return null;
  const payload = await verifyPayload<OAuthState>(stateParam, secret, now);
  if (!payload || typeof payload.n !== "string" || typeof payload.next !== "string") return null;
  return { next: payload.next };
}

export function googleAuthorizeUrl(config: GoogleConfig, redirectUri: string, state: string, loginHint?: string | null): string {
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  url.searchParams.set("access_type", "online");
  if (loginHint) url.searchParams.set("login_hint", loginHint);
  return url.toString();
}

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
}

/** Exchanges the code for tokens and asks Google who the person is. Throws on any transport or protocol failure. */
export async function fetchGoogleProfile(config: GoogleConfig, code: string, redirectUri: string, fetchImpl: typeof fetch = fetch): Promise<GoogleProfile> {
  const tokenRes = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    signal: AbortSignal.timeout(15_000),
  });
  const tokens = (await tokenRes.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!tokenRes.ok || !tokens.access_token) throw new Error(`Google token exchange failed: ${tokens.error_description ?? tokens.error ?? `HTTP ${tokenRes.status}`}`);

  const infoRes = await fetchImpl(GOOGLE_USERINFO_URL, { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(15_000) });
  const info = (await infoRes.json().catch(() => ({}))) as { sub?: string; email?: string; email_verified?: boolean | string; name?: string };
  if (!infoRes.ok || typeof info.sub !== "string" || typeof info.email !== "string") throw new Error(`Google userinfo failed: HTTP ${infoRes.status}`);
  return { sub: info.sub, email: info.email.trim().toLowerCase(), emailVerified: info.email_verified === true || info.email_verified === "true", name: typeof info.name === "string" ? info.name : null };
}

export type GoogleSignInResult = { ok: true; user: UserRecord; next: string } | { ok: false; reason: "state" | "denied" | "unverified" | "no_account" | "failed"; next?: string };

/**
 * The callback's decision: verify the state, get the Google identity, and map
 * it onto an existing account. Never creates users.
 */
export async function completeGoogleSignIn(
  input: { code: string | null; state: string | null; cookieState: string | null; error: string | null; redirectUri: string },
  deps: { config: GoogleConfig; secret: string; fetchImpl?: typeof fetch; now?: number },
): Promise<GoogleSignInResult> {
  const state = await verifyOAuthState(input.state, input.cookieState, deps.secret, deps.now);
  if (!state) return { ok: false, reason: "state" };
  if (input.error || !input.code) return { ok: false, reason: "denied", next: state.next };
  let profile: GoogleProfile;
  try {
    profile = await fetchGoogleProfile(deps.config, input.code, input.redirectUri, deps.fetchImpl);
  } catch (error) {
    console.error(`[auth] google sign-in failed: ${error instanceof Error ? error.message : error}`);
    return { ok: false, reason: "failed", next: state.next };
  }
  if (!profile.emailVerified) return { ok: false, reason: "unverified", next: state.next };
  const found = await repository.findUserByEmail(profile.email);
  if (!found) return { ok: false, reason: "no_account", next: state.next };
  return { ok: true, user: found.user, next: state.next };
}

/** What the login page says for each way a Google sign-in can end without a session. */
export const GOOGLE_SIGN_IN_MESSAGES: Record<Exclude<GoogleSignInResult, { ok: true }>["reason"] | "unavailable", string> = {
  state: "That sign-in link has expired or was opened in a different browser. Please try again.",
  denied: "Google sign-in was cancelled.",
  unverified: "Google has not verified that email address, so it cannot be used to sign in.",
  no_account: "There is no account here for that Google email. Ask the person who set you up to invite you, then try again.",
  failed: "Google sign-in did not complete. Please try again, or sign in with your password.",
  unavailable: "Google sign-in is not set up on this deployment.",
};

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
