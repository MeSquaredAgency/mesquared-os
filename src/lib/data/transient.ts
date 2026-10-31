/**
 * Transient database failures: the ones a fresh connection fixes. A dropped
 * socket, a connection the pooler (Hyperdrive, Neon) closed under us, a
 * connect that timed out, the database restarting. None of these mean the
 * query was wrong, so reads are retried a couple of times before a page is
 * allowed to fail. Writes are never retried here: a create that timed out
 * after reaching the server would run twice.
 */

/** Prisma error codes for "could not reach or keep the connection". */
const PRISMA_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);

/** PostgreSQL SQLSTATE classes 08 (connection exception), 57P0x (operator intervention), 53300 (too many connections). */
const PG_CODES = new Set(["08000", "08001", "08003", "08004", "08006", "08007", "57P01", "57P02", "57P03", "53300"]);

/** Node socket error codes. */
const SOCKET_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN", "ECONNABORTED", "EHOSTUNREACH"]);

/** Driver-adapter error kinds that Prisma attaches to the cause. */
const ADAPTER_KINDS = new Set(["SocketTimeout", "ConnectionClosed", "TooManyConnections", "DatabaseNotReachable", "DatabaseDoesNotExist"]);

const MESSAGE_PATTERNS = [
  /connection terminated/i,
  /terminating connection/i,
  /server (has )?closed the connection/i,
  /connection (was |is )?closed/i,
  /connection ended/i,
  /timeout exceeded when trying to connect/i,
  /connection timed out/i,
  /connect ETIMEDOUT/i,
  /socket hang up/i,
  /hyperdrive/i,
  /cannot perform i\/o on behalf of a different request/i,
  /too many (clients|connections)/i,
  /remaining connection slots are reserved/i,
  /the database system is (starting up|shutting down|in recovery)/i,
  /can'?t reach database server/i,
  /timed out fetching a new connection/i,
  /network error/i,
  /fetch failed/i,
  /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE/,
];

// Model reads only. Raw SQL is excluded on purpose: `$queryRaw` carries the rate-limit upsert, and nothing about the
// operation name says whether a raw statement writes.
const READ_OPERATIONS = new Set(["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy"]);

/** True for Prisma operations that are safe to run again after a connection failure. */
export function isReadOperation(operation: string): boolean {
  return READ_OPERATIONS.has(operation);
}

type Errorish = { message?: unknown; code?: unknown; kind?: unknown; cause?: unknown; meta?: unknown; errno?: unknown; originalError?: unknown; driverAdapterError?: unknown };

/** Walks an error and its causes (Prisma wraps the driver's error twice) and says whether a retry could help. */
export function isTransientDbError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 6) return false;
  const e = error as Errorish;
  const code = typeof e.code === "string" ? e.code : null;
  if (code && (PRISMA_CODES.has(code) || PG_CODES.has(code) || SOCKET_CODES.has(code))) return true;
  if (typeof e.kind === "string" && ADAPTER_KINDS.has(e.kind)) return true;
  if (typeof e.message === "string" && MESSAGE_PATTERNS.some((p) => p.test(e.message as string))) return true;
  return [e.cause, e.meta, e.originalError, e.driverAdapterError].some((inner) => isTransientDbError(inner, depth + 1));
}

export interface RetryOptions {
  /** Total attempts including the first. */
  attempts?: number;
  /** Delay before the second attempt; doubles after that, with a little jitter. */
  baseDelayMs?: number;
  isRetryable?: (error: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (error: unknown, attempt: number) => void;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs `fn`, retrying transient failures with a short backoff. The last error is thrown as-is. */
export async function withTransientRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const base = opts.baseDelayMs ?? 150;
  const retryable = opts.isRetryable ?? isTransientDbError;
  const sleep = opts.sleep ?? wait;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    try {
      return await fn();
    } catch (error) {
      if (attempt >= attempts || !retryable(error)) throw error;
      opts.onRetry?.(error, attempt);
      await sleep(base * 2 ** (attempt - 1) + Math.floor(Math.random() * 50));
    }
  }
}
