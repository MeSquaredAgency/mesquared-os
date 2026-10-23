import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** True when a database is configured. Otherwise the data layer uses demo fixtures. */
export const hasDatabase = Boolean(process.env.DATABASE_URL);

/**
 * Lazily constructs the Prisma client so demo mode never touches the engine
 * (and never requires `prisma generate` to have run).
 */
export function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
  }
  return globalForPrisma.prisma;
}
