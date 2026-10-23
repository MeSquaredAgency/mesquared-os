/**
 * Small in-memory limiter for sign-in attempts.
 *
 * Two dimensions: per (ip, email) pair and per ip, both hard-locked after
 * MAX_FAILURES in the window. The email alone is never hard-locked, so an
 * attacker who knows an operator's address cannot keep them locked out;
 * instead repeated failures on an email add a growing delay.
 *
 * State is per process and bounded; move counters to Postgres/Redis when the
 * app runs on more than one instance.
 */
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 5;
const MAX_ENTRIES = 10_000;

interface Entry {
  count: number;
  first: number;
}

const failures = new Map<string, Entry>();

function prune(now: number) {
  if (failures.size < MAX_ENTRIES) return;
  for (const [key, entry] of failures) {
    if (now - entry.first > WINDOW_MS) failures.delete(key);
  }
  // Still too big (a flood of distinct keys): drop the oldest half.
  if (failures.size >= MAX_ENTRIES) {
    const keys = [...failures.keys()].slice(0, Math.floor(failures.size / 2));
    for (const k of keys) failures.delete(k);
  }
}

function get(key: string, now: number): Entry | null {
  const entry = failures.get(key);
  if (!entry) return null;
  if (now - entry.first > WINDOW_MS) {
    failures.delete(key);
    return null;
  }
  return entry;
}

/** True when the key has reached the hard limit inside the window. */
export function isLocked(key: string, now = Date.now()): boolean {
  const entry = get(key, now);
  return Boolean(entry && entry.count >= MAX_FAILURES);
}

/** Milliseconds to stall a request for this key: 0, then 0.5s, 1s, 2s… capped at 4s. */
export function delayFor(key: string, now = Date.now()): number {
  const entry = get(key, now);
  if (!entry || entry.count === 0) return 0;
  return Math.min(4000, 250 * 2 ** entry.count);
}

export function recordFailure(key: string, now = Date.now()) {
  prune(now);
  const entry = get(key, now);
  if (!entry) failures.set(key, { count: 1, first: now });
  else entry.count += 1;
}

export function clearFailures(key: string) {
  failures.delete(key);
}

/** Exposed for tests. */
export function _resetRateLimiter() {
  failures.clear();
}
