/**
 * Small in-memory limiter for sign-in attempts. Good enough for a single
 * instance; swap for Redis/Upstash when the app runs on more than one node.
 */
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 5;

const failures = new Map<string, { count: number; first: number }>();

export function isLocked(key: string, now = Date.now()): boolean {
  const entry = failures.get(key);
  if (!entry) return false;
  if (now - entry.first > WINDOW_MS) {
    failures.delete(key);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

export function recordFailure(key: string, now = Date.now()) {
  const entry = failures.get(key);
  if (!entry || now - entry.first > WINDOW_MS) failures.set(key, { count: 1, first: now });
  else entry.count += 1;
}

export function clearFailures(key: string) {
  failures.delete(key);
}

/** Exposed for tests. */
export function _resetRateLimiter() {
  failures.clear();
}
