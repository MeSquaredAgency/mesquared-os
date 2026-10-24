import { randomBytes } from "node:crypto";
import type { TrackedLinkRecord } from "@/lib/types";

/**
 * Tracked links: /r/<code> redirects to the destination with the link's UTMs
 * stamped on, counts the click, and drops a first-party attribution cookie so
 * a form filled later still knows where the person came from.
 */

const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function generateLinkCode(prefix?: string | null): string {
  const bytes = randomBytes(6);
  let code = "";
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  const safe = prefix ? prefix.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) : "";
  return safe ? `${safe}-${code}` : code;
}

export function isValidCode(code: string): boolean {
  return /^[a-z0-9][a-z0-9-]{2,60}$/.test(code);
}

/** The destination with utm_* parameters applied (existing ones on the destination are kept). */
export function destinationWithUtms(link: Pick<TrackedLinkRecord, "destination" | "source" | "medium" | "campaign" | "content" | "code">): string {
  const url = new URL(link.destination);
  const set = (k: string, v: string | null) => {
    if (v && !url.searchParams.has(k)) url.searchParams.set(k, v);
  };
  set("utm_source", link.source);
  set("utm_medium", link.medium);
  set("utm_campaign", link.campaign);
  set("utm_content", link.content);
  set("msq_link", link.code);
  return url.toString();
}

/** What the attribution cookie carries. */
export function attributionCookieValue(link: Pick<TrackedLinkRecord, "source" | "medium" | "campaign" | "content" | "code">): string {
  return JSON.stringify({ utm_source: link.source, utm_medium: link.medium, utm_campaign: link.campaign, utm_content: link.content, msq_link: link.code, at: new Date().toISOString() });
}

export function parseAttributionCookie(raw: string | undefined | null): Record<string, string> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "msq_link"]) if (typeof v[k] === "string" && v[k]) out[k] = String(v[k]).slice(0, 100);
    return out;
  } catch {
    return {};
  }
}

export const ATTRIBUTION_COOKIE = "msq_attr";
