/**
 * Which Neon services this deployment has credentials for.
 *
 * `neon deploy` (or `neon env pull`) writes these variables for the linked
 * branch; see neon.ts for what is declared. Nothing here puts a value into a
 * log or a response, only whether it is present, and demo mode keeps working
 * with none of them set.
 */
export interface NeonServices {
  /** Prisma on the pooled DATABASE_URL. */
  postgres: boolean;
  /** Claude via the branch's AI Gateway (NEON_AI_GATEWAY_*). */
  aiGateway: boolean;
  /** S3-compatible bucket "assets" (AWS_* variables). */
  objectStorage: boolean;
  /** Live queries (NEON_REALTIME_*); needs Postgres too. */
  realtime: boolean;
}

export function neonServices(env: Record<string, string | undefined> = process.env): NeonServices {
  return {
    postgres: Boolean(env.DATABASE_URL),
    aiGateway: Boolean(env.NEON_AI_GATEWAY_BASE_URL && env.NEON_AI_GATEWAY_TOKEN),
    objectStorage: Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.AWS_ENDPOINT_URL_S3),
    realtime: Boolean(env.DATABASE_URL && env.NEON_REALTIME_URL && env.NEON_REALTIME_SECRET),
  };
}

/** Base host and credential for the branch's AI Gateway, or null when it is not configured. */
export function aiGatewayConfig(env: Record<string, string | undefined> = process.env): { baseURL: string; apiKey: string } | null {
  const baseURL = env.NEON_AI_GATEWAY_BASE_URL?.trim().replace(/\/+$/, "");
  const apiKey = env.NEON_AI_GATEWAY_TOKEN?.trim();
  return baseURL && apiKey ? { baseURL, apiKey } : null;
}

/** The database name in a Postgres connection string: "neondb" for postgresql://u:p@host/neondb?sslmode=require. */
export function databaseName(connectionString: string | undefined): string | null {
  if (!connectionString) return null;
  try {
    const name = decodeURIComponent(new URL(connectionString).pathname.replace(/^\/+/, ""));
    return name || null;
  } catch {
    return null;
  }
}
