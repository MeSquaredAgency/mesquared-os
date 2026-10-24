/**
 * Token-bucket limiter for the intake endpoint, keyed per tenant. Tenant API
 * keys sit in public web forms by design, so a scraped key must not translate
 * into unbounded classifier spend or a flood of tasks and booking links.
 *
 * Per process; move to Redis/Postgres when running more than one instance.
 */
const CAPACITY = Number.parseInt(process.env.INTAKE_RATE_LIMIT_PER_MINUTE ?? "60", 10) || 60;
const REFILL_PER_MS = CAPACITY / 60_000;
const MAX_BUCKETS = 10_000;

interface Bucket {
  tokens: number;
  updated: number;
}

const buckets = new Map<string, Bucket>();

export function takeIntakeToken(key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
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

/** Exposed for tests. */
export function _resetIntakeLimiter() {
  buckets.clear();
}

/** Per-IP and per-tenant buckets together: a public key can no longer be used to exhaust a tenant's bucket from one machine. */
export function takeIntakeTokens(keys: string[], now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
  let worst = { allowed: true, retryAfterSeconds: 0 };
  for (const key of keys) {
    const r = takeIntakeToken(key, now);
    if (!r.allowed) worst = { allowed: false, retryAfterSeconds: Math.max(worst.retryAfterSeconds, r.retryAfterSeconds) };
  }
  return worst;
}
