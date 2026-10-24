import { PrismaClient } from "@prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";

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

function construct(): PrismaClient {
  const log: ("warn" | "error")[] = process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"];
  const connectionString = process.env.DATABASE_URL ?? "";
  switch (driver()) {
    case "neon":
      return new PrismaClient({ adapter: new PrismaNeon({ connectionString }), log });
    case "pg":
      // One use per pooled connection: Workers isolates must not hold sockets between requests.
      return new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 2, maxUses: 1 }), log });
    default:
      return new PrismaClient({ log });
  }
}

/**
 * Lazily constructs the Prisma client so demo mode never touches the engine
 * (and never requires `prisma generate` to have run).
 */
export function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) globalForPrisma.prisma = construct();
  return globalForPrisma.prisma;
}
