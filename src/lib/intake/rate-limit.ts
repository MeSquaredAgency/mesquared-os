import { dataMode, repository } from "@/lib/data";

/**
 * Rate limiter for the public endpoints (intake, beacon, tracked forms,
 * uploads, inbound call/email), keyed per tenant and per client IP. Tenant
 * intake keys sit in public web forms by design, so a scraped key must not
 * translate into unbounded classifier spend or a flood of tasks and booking
 * links.
 *
 * On Postgres the counters live in a table shared by every instance (fixed
 * one-minute windows, one atomic upsert per key), because serverless isolates
 * each start with empty memory and a limiter kept in one of them holds nothing
 * back. Demo mode keeps the in-process token bucket.
 */
const CAPACITY = Number.parseInt(process.env.INTAKE_RATE_LIMIT_PER_MINUTE ?? "60", 10) || 60;
const WINDOW_MS = 60_000;
const REFILL_PER_MS = CAPACITY / WINDOW_MS;
const MAX_BUCKETS = 10_000;

interface Bucket {
  tokens: number;
  updated: number;
}

const buckets = new Map<string, Bucket>();

function takeLocalToken(key: string, now: number): { allowed: boolean; retryAfterSeconds: number } {
  let bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size >= MAX_BUCKETS) buckets.delete(buckets.keys().next().value as string);
    bucket = { tokens: CAPACITY, updated: now };
    buckets.set(key, bucket);
  }
  bucket.tokens = Math.min(CAPACITY, bucket.tokens + (now - bucket.updated) * REFILL_PER_MS);
  bucket.updated = now;
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
  return { allowed: false, retryAfterSeconds: Math.ceil((1 - bucket.tokens) / REFILL_PER_MS / 1000) };
}

export async function takeIntakeToken(key: string, now = Date.now()): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  if (dataMode !== "postgres") return takeLocalToken(key, now);
  const { count, windowStart } = await repository.rateLimitHit(`intake:${key}`, WINDOW_MS, new Date(now));
  if (count <= CAPACITY) return { allowed: true, retryAfterSeconds: 0 };
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((windowStart.getTime() + WINDOW_MS - now) / 1000)) };
}

/** Exposed for tests. */
export function _resetIntakeLimiter() {
  buckets.clear();
}

/** Per-IP and per-tenant buckets together: a public key can no longer be used to exhaust a tenant's bucket from one machine. */
export async function takeIntakeTokens(keys: string[], now = Date.now()): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  let worst = { allowed: true, retryAfterSeconds: 0 };
  for (const key of keys) {
    const r = await takeIntakeToken(key, now);
    if (!r.allowed) worst = { allowed: false, retryAfterSeconds: Math.max(worst.retryAfterSeconds, r.retryAfterSeconds) };
  }
  return worst;
}
