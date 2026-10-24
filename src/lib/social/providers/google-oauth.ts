import { requestJson } from "./http";
import type { ChannelCredentials } from "./types";

/**
 * Google OAuth2 token refresh shared by the Google Business Profile and
 * YouTube adapters.
 *
 * Endpoint: POST https://oauth2.googleapis.com/token (grant_type=refresh_token)
 * Env:      GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET
 *
 * The refresh token itself is only ever sent in the form body of that one
 * request; nothing here logs or returns it anywhere else.
 */

export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Treat a token as expired a minute early so a call never starts with a token that dies mid-flight. */
const EXPIRY_SKEW_MS = 60_000;

export function tokenExpired(creds: ChannelCredentials, now = Date.now()): boolean {
  if (!creds.expiresAt) return false;
  const at = new Date(creds.expiresAt).getTime();
  return Number.isFinite(at) && at - EXPIRY_SKEW_MS <= now;
}

export type RefreshOutcome = { ok: true; creds: ChannelCredentials } | { ok: false; error: string; retryable: boolean };

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

/** Exchanges the refresh token for a new access token. Returns a failure value, never throws. */
export async function refreshGoogleToken(creds: ChannelCredentials, env: NodeJS.ProcessEnv = process.env): Promise<RefreshOutcome> {
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!creds.refreshToken) return { ok: false, error: "Google token expired and no refresh token is stored; reconnect the channel", retryable: false };
  if (!clientId || !clientSecret) return { ok: false, error: "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET are not configured", retryable: false };
  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: creds.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await requestJson<GoogleTokenResponse>(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    fallback: "Google token refresh failed",
  });
  if (!res.ok) return { ok: false, error: `Google token refresh failed: ${res.error}`, retryable: res.retryable };
  const accessToken = res.body.access_token;
  if (!accessToken) return { ok: false, error: "Google token refresh returned no access token", retryable: false };
  const expiresIn = typeof res.body.expires_in === "number" ? res.body.expires_in : 3600;
  return {
    ok: true,
    creds: {
      ...creds,
      accessToken,
      refreshToken: res.body.refresh_token ?? creds.refreshToken,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    },
  };
}

/** The credentials to use for a call: refreshed first when `expiresAt` is past, otherwise as given. */
export async function freshGoogleCredentials(creds: ChannelCredentials): Promise<RefreshOutcome> {
  if (!tokenExpired(creds)) return { ok: true, creds };
  return refreshGoogleToken(creds);
}

/** Implements `SocialProvider.refreshCredentials` for Google-backed adapters: null when nothing could be refreshed. */
export async function refreshGoogleCredentials(creds: ChannelCredentials): Promise<ChannelCredentials | null> {
  if (!creds.refreshToken) return null;
  const r = await refreshGoogleToken(creds);
  if (!r.ok) {
    console.warn(`[social:google] token refresh failed: ${r.error}`);
    return null;
  }
  return r.creds;
}
