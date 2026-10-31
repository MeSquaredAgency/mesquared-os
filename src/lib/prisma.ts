import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { isReadOperation, withTransientRetry } from "@/lib/data/transient";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** True when a database is configured. Otherwise the data layer uses demo fixtures. */
export const hasDatabase = Boolean(process.env.DATABASE_URL);

/**
 * Which driver talks to Postgres:
 *   - unset (Node on Vercel or a VM): Prisma's own engine over TCP
 *   - "pg": node-postgres through the driver adapter (the default on Cloudflare Workers, where the engine runs as wasm;
 *     with Hyperdrive, DATABASE_URL is the Hyperdrive connection string)
 *   - "neon": the Neon serverless driver over HTTP/WebSocket (no TCP at all)
 */
const onWorkers = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
const driver = (): "engine" | "pg" | "neon" => {
  const wanted = process.env.DATABASE_DRIVER;
  if (wanted === "neon" || wanted === "pg") return wanted;
  return onWorkers ? "pg" : "engine";
};

/**
 * The Cloudflare request context, when there is one. OpenNext keeps it in
 * AsyncLocalStorage, so the object is new for every request and is the key
 * that scopes a database client to that request (see `getPrisma`).
 */
function requestContext(): { env: Record<string, unknown> } | null {
  if (!onWorkers) return null;
  try {
    const context = getCloudflareContext() as unknown as { env: Record<string, unknown> } | undefined;
    return context ?? null;
  } catch {
    return null;
  }
}

/** On Workers, a Hyperdrive binding (pooled, near the Worker) wins over the raw DATABASE_URL secret. */
function workersConnectionString(context: { env: Record<string, unknown> } | null): string | null {
  const hyperdrive = context?.env.HYPERDRIVE as { connectionString?: string } | undefined;
  return hyperdrive?.connectionString ?? null;
}

/**
 * Retries read queries that failed on a dropped or refused connection. Writes
 * are left alone: a create that reached the server before the socket died
 * must not run twice. Transient failures are logged once so the Worker log
 * shows how often the pooler drops us without any page failing.
 */
function withReadRetries(client: PrismaClient): PrismaClient {
  return client.$extends({
    query: {
      $allOperations({ model, operation, args, query }) {
        if (!isReadOperation(operation)) return query(args);
        return withTransientRetry(() => query(args), {
          onRetry: (error, attempt) => console.warn(`[db] retrying ${model ?? "raw"}.${operation} after attempt ${attempt}: ${error instanceof Error ? error.message : String(error)}`),
        });
      },
    },
  }) as unknown as PrismaClient;
}

function construct(context: { env: Record<string, unknown> } | null): PrismaClient {
  const log: ("warn" | "error")[] = process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"];
  const connectionString = workersConnectionString(context) ?? process.env.DATABASE_URL ?? "";
  switch (driver()) {
    case "neon":
      return withReadRetries(new PrismaClient({ adapter: new PrismaNeon({ connectionString }), log }));
    case "pg":
      // A connect that hangs becomes an error (and a retry) instead of a page that never finishes. On Workers the pool
      // belongs to one request (see getPrisma), so a handful of connections can be reused for the dozens of queries a
      // page runs and idle ones are dropped with the request; on Node it is the usual long-lived pool.
      return withReadRetries(new PrismaClient({ adapter: new PrismaPg({ connectionString, max: onWorkers ? 5 : 10, connectionTimeoutMillis: 10_000, idleTimeoutMillis: onWorkers ? 5_000 : 30_000 }), log }));
    default:
      return withReadRetries(new PrismaClient({ log }));
  }
}

/** One client per Workers request, dropped with the request (WeakMap: nothing to clean up). */
const perRequest = new WeakMap<object, PrismaClient>();

/**
 * The Prisma client for the current request.
 *
 * On Cloudflare Workers a socket may only be used by the request that opened
 * it; a pool shared across requests in one isolate hands connections opened
 * for one page to another and fails with "Cannot perform I/O on behalf of a
 * different request", or loses them when the first request finishes. So each
 * request gets its own client and pool, keyed on OpenNext's request context.
 *
 * Elsewhere (Node), one lazily constructed client is shared, so demo mode
 * never touches the engine and never requires `prisma generate` to have run.
 */
export function getPrisma(): PrismaClient {
  const context = requestContext();
  if (context) {
    let client = perRequest.get(context);
    if (!client) {
      client = construct(context);
      perRequest.set(context, client);
    }
    return client;
  }
  if (!globalForPrisma.prisma) globalForPrisma.prisma = construct(null);
  return globalForPrisma.prisma;
}
