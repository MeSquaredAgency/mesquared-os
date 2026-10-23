import { hasDatabase } from "@/lib/prisma";
import type { Repository } from "./repository";
import { memoryRepository } from "./memory";
import { prismaRepository } from "./prisma-repository";

export type { Repository, Workbench } from "./repository";
export { TenantMismatchError } from "./repository";

/**
 * Demo mode (in-memory fixtures, public demo API keys, a default operator
 * password) is only ever selected deliberately: outside production it is the
 * fallback when DATABASE_URL is unset; in production it must be requested
 * with DATA_MODE=demo, and a missing database is otherwise a startup failure
 * rather than a silent downgrade.
 */
function resolveDataMode(): "postgres" | "demo" {
  if (hasDatabase) return "postgres";
  // `next build` collects page data with NODE_ENV=production; the guard is for running servers only.
  const building = process.env.NEXT_PHASE === "phase-production-build";
  const production = process.env.NODE_ENV === "production" && !building;
  if (production && process.env.DATA_MODE !== "demo") {
    throw new Error("DATABASE_URL is not set. Refusing to start in demo mode in production (set DATA_MODE=demo to override).");
  }
  if (production && (process.env.DEMO_OPERATOR_PASSWORD ?? "mesquared-demo") === "mesquared-demo") {
    throw new Error("DEMO_OPERATOR_PASSWORD must be changed from the default before running demo mode in production.");
  }
  return "demo";
}

export const dataMode: "postgres" | "demo" = resolveDataMode();

/** Single data-access entry point for the app. */
export const repository: Repository = dataMode === "postgres" ? prismaRepository : memoryRepository;
