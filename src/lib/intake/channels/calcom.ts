import { createHmac, timingSafeEqual } from "node:crypto";

/** Cal.com signs the raw body with HMAC-SHA256 (hex) in `x-cal-signature-256`. */
export function verifyCalcomSignature(rawBody: string, header: string | null | undefined, secret: string): boolean {
  const given = header ?? "";
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
