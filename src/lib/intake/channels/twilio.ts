import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Twilio signs each webhook: base64(HMAC-SHA1(authToken, url + the POST
 * params sorted by name and concatenated as name+value)). The URL must be
 * exactly what Twilio called, so a deployment behind a proxy or a custom
 * domain sets TWILIO_WEBHOOK_URL rather than trusting the request URL.
 */
export function verifyTwilioSignature(url: string, params: Record<string, string>, signature: string | null | undefined, authToken: string): boolean {
  if (!signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = createHmac("sha1", authToken).update(data).digest("base64");
  return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
