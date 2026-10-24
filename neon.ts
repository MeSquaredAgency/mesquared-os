import { defineConfig } from "@neon/config/v1";

/**
 * Neon branch configuration for MeSquared OS (applied with `neon deploy --env .env`).
 *
 * - Postgres is implicit on every branch: Prisma reads the pooled `DATABASE_URL`
 *   and migrates over `DATABASE_URL_UNPOOLED`.
 * - `aiGateway` is off: the qualifier uses ANTHROPIC_API_KEY; flip it on (paid plan) to use the gateway.
 * - The private `assets` bucket holds tenant uploads (src/lib/storage.ts).
 * - The `ops` Function reports database health next to the data and, on a
 *   one-minute trigger, forwards the scheduler tick to the app.
 * - Realtime powers the live lead list in the Client Portal (src/lib/realtime).
 *
 * Function env is read from the file passed to `--env`. The tick is only
 * forwarded to a deployment Neon can reach, so a localhost NEXT_PUBLIC_APP_URL
 * leaves the function in report-only mode rather than uploading a useless URL.
 */
const appUrl = process.env.NEXT_PUBLIC_APP_URL;
const jobSecret = process.env.JOB_SECRET;
const reachableApp = Boolean(appUrl && /^https?:\/\//.test(appUrl) && !/\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(appUrl));
const tickEnv = reachableApp && jobSecret ? { APP_URL: appUrl as string, JOB_SECRET: jobSecret } : undefined;

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

const allowedOrigins = Array.from(new Set(["http://localhost:3000", originOf(appUrl)].filter((o): o is string => Boolean(o))));

export default defineConfig({
  auth: false,
  // Off by decision (24 Oct 2026): lead qualification uses a direct ANTHROPIC_API_KEY. The
  // gateway code path in src/lib/qualify stays; set this to true (paid plan) to switch over.
  aiGateway: false,
  buckets: {
    // Tenant files live under tenants/<tenantId>/…; the app presigns reads, nothing is public.
    assets: { access: "private" },
  },
  functions: {
    ops: {
      name: "MeSquared OS ops",
      source: "./neon/functions/ops.ts",
      ...(tickEnv ? { env: tickEnv } : {}),
    },
  },
  triggers: {
    // README: "run POST /api/jobs/tick every minute". The function forwards it with JOB_SECRET.
    "tick-every-minute": { type: "schedule", function: "ops", cron: "* * * * *", functionPath: "/tick" },
  },
  preview: {
    realtime: { allowedOrigins },
  },
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Production: the ops Function must forward the tick, or SLA detection and scheduled sends stop silently.
      if (!tickEnv && process.env.ALLOW_DEPLOY_WITHOUT_TICK !== "1") {
        throw new Error("Refusing to deploy the production branch without tick forwarding: set a public NEXT_PUBLIC_APP_URL and JOB_SECRET in the env file passed to --env (or ALLOW_DEPLOY_WITHOUT_TICK=1 to override).");
      }
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});
