import { dataMode, repository } from "@/lib/data";

/**
 * Limiter for sign-in attempts.
 *
 * Two dimensions: per (ip, email) pair and per ip, both hard-locked after
 * MAX_FAILURES in the window. The email alone is never hard-locked, so an
 * attacker who knows an operator's address cannot keep them locked out;
 * instead repeated failures on an email add a growing delay.
 *
 * On Postgres the counters are shared by every instance (serverless isolates
 * would otherwise each allow a fresh five attempts). Demo mode keeps them in
 * memory.
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

function localCount(key: string, now: number): number {
  const entry = failures.get(key);
  if (!entry) return 0;
  if (now - entry.first > WINDOW_MS) {
    failures.delete(key);
    return 0;
  }
  return entry.count;
}

async function countFor(key: string, now: number): Promise<number> {
  if (dataMode !== "postgres") return localCount(key, now);
  return repository.rateLimitPeek(`login:${key}`, WINDOW_MS, new Date(now));
}

/** True when the key has reached the hard limit inside the window. */
export async function isLocked(key: string, now = Date.now()): Promise<boolean> {
  return (await countFor(key, now)) >= MAX_FAILURES;
}

/** Milliseconds to stall a request for this key: 0, then 0.5s, 1s, 2s… capped at 4s. */
export async function delayFor(key: string, now = Date.now()): Promise<number> {
  const count = await countFor(key, now);
  return count === 0 ? 0 : Math.min(4000, 250 * 2 ** count);
}

export async function recordFailure(key: string, now = Date.now()): Promise<void> {
  if (dataMode === "postgres") {
    await repository.rateLimitHit(`login:${key}`, WINDOW_MS, new Date(now));
    return;
  }
  prune(now);
  const count = localCount(key, now);
  if (count === 0) failures.set(key, { count: 1, first: now });
  else failures.get(key)!.count += 1;
}

export async function clearFailures(key: string): Promise<void> {
  if (dataMode === "postgres") await repository.rateLimitClear(`login:${key}`);
  failures.delete(key);
}

/** Exposed for tests. */
export function _resetRateLimiter() {
  failures.clear();
}
