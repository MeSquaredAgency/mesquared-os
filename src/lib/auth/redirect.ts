/** Only allow same-origin relative paths as a post-login destination. */
export function safeNext(value: string | null | undefined, fallback = "/dashboard"): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\r\n]/.test(value) || value.startsWith("/login")) return fallback;
  return value;
}
