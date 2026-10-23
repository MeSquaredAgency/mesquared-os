export const SESSION_COOKIE = "msq_session";

/** A session is renewed while in use, up to the absolute maximum age. */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
/** No session lives longer than this since the original sign-in, however active. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const DEV_FALLBACK_SECRET = "mesquared-os-dev-secret-change-me";
let warned = false;

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
  if (!warned) {
    warned = true;
    console.warn("[auth] AUTH_SECRET is not set; using the development fallback secret.");
  }
  return DEV_FALLBACK_SECRET;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};
