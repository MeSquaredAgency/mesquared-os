export const SESSION_COOKIE = "msq_session";

/** Sessions last 7 days and are renewed on each authenticated page load past the half-way point. */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

const DEV_FALLBACK_SECRET = "mesquared-os-dev-secret-change-me";

/**
 * Secret for signing session cookies. Required in production; a fixed
 * development fallback keeps demo mode zero-config.
 */
export function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (secret && secret.length >= 16) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET must be set (at least 16 characters) in production.");
  }
  return DEV_FALLBACK_SECRET;
}
