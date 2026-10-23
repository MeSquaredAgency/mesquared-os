/**
 * Best-effort client IP from proxy headers.
 *
 * Platform-set headers come first because clients cannot forge them. For
 * X-Forwarded-For we take the *last* hop, which is the one appended by the
 * nearest trusted proxy; the first hop is client-controlled. Set
 * TRUSTED_PROXY_HOPS when there is more than one proxy in front of the app.
 */
export function clientIpFromHeaders(get: (name: string) => string | null): string {
  const direct = get("cf-connecting-ip") ?? get("x-vercel-forwarded-for") ?? get("fly-client-ip") ?? get("true-client-ip");
  if (direct) return direct.trim();

  const xff = get("x-forwarded-for");
  if (xff) {
    const hops = xff.split(",").map((s) => s.trim()).filter(Boolean);
    const trusted = Math.max(1, Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "1", 10) || 1);
    const pick = hops[Math.max(0, hops.length - trusted)];
    if (pick) return pick;
  }
  return get("x-real-ip")?.trim() || "unknown";
}
