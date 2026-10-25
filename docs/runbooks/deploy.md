# Deploy

## What runs where

- **App**: Next.js 15 on Cloudflare Workers through OpenNext, at
  `https://os.mesquaredagency.com` (details in [cloudflare.md](cloudflare.md)).
  Deployed by GitHub Actions from `main`. The public URL is the
  `NEXT_PUBLIC_APP_URL` var in `wrangler.jsonc`.
- **Database**: Neon Postgres, production branch, reached from the worker
  through Hyperdrive. `DATABASE_URL` is the pooled URL, `DATABASE_URL_UNPOOLED`
  the direct one Prisma uses for migrations.
- **Scheduler**: the worker's own minute cron (`cloudflare/worker.ts`) calls
  `POST /api/jobs/tick` with `JOB_SECRET`. The Neon `ops` Function in `neon.ts`
  is an optional fallback caller.

## Before every deploy

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

With the embedded Postgres running (`node scripts/local-postgres.mjs start`),
also run the parity check so the Prisma repository is exercised:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:54329/mesquared_os MESSAGING_MODE=log npm run db:parity
```

CI runs both jobs on every push; do not deploy a red build.

## Migrations

Migrations live in `prisma/migrations` and are generated with
`prisma migrate diff` (the dev command is interactive and not used). The
deploy workflow applies them to production (`prisma migrate deploy` with the
`DATABASE_URL` repository secret) after building the worker and before
uploading it, so nobody runs them by hand against production. Applying one
locally against the embedded database is still how a migration is checked
before it is pushed.

If a migration fails, the workflow stops before the upload and every later
deploy fails with Prisma's P3009 until it is resolved: revert any partial DDL
by hand, run `npx prisma migrate resolve --rolled-back <name>` against the
direct URL, fix the migration, push again.

`migrate deploy` is additive and safe to re-run. A migration that drops or
renames a column ships in two releases: first add and backfill, then remove
once nothing reads the old column.

## Deploying the app

1. Merge to `main` with CI green. Nothing else is needed: the Deploy
   workflow (`.github/workflows/deploy.yml`) builds the worker, applies
   migrations and uploads it, about four minutes after CI passes. Watch it in
   the Actions tab; a failed run leaves the previous version serving.
2. Confirm the environment variables in [`.env.example`](../../.env.example)
   are set as worker vars or secrets; the deployment half of **Launch
   readiness** in the console (`/console/<slug>/settings`) lists the ones
   that are missing. Plain vars live in `wrangler.jsonc` (a deploy replaces
   dashboard-only vars); secrets are set in the dashboard and survive deploys.
3. Open `GET /api/v1/health` on the public URL: 200 with `database: "ok"` and
   a scheduler tick in the last five minutes, else 503.
4. Sign in as a platform admin and open the console: the portfolio must list
   the real workspaces, not the demo ones.

## Deploying the Neon branch (optional: Function, trigger, bucket)

```bash
set -a; . ./.env.neon.local; set +a
NEON_PROFILE=agent neon deploy --env .env
npm run neon:check
```

`neon.ts` refuses a production deploy that would leave the tick unforwarded
unless `ALLOW_DEPLOY_WITHOUT_TICK=1` is set. Only set it when the public URL
does not exist yet, and redeploy with tick forwarding as soon as it does.

## Rolling back

- **App**: in the Cloudflare dashboard, Workers & Pages → mesquared-os →
  Deployments → roll back to the previous version; or revert the commit on
  `main` and let the workflow deploy it. The app is stateless.
- **Schema**: migrations are forward-only. If a release must come back and its
  migration is incompatible, restore the Neon branch to the point in time
  before the deploy (see [secrets-and-backups.md](secrets-and-backups.md)) and
  redeploy the previous app build against it. Expect to lose writes made in
  between, so do this only for a broken release, never for a bad row.

## Modes that must be off in production

`MESSAGING_MODE`, `SOCIAL_MODE`, `ADS_MODE`, `FINANCE_MODE` and `INVENTORY_MODE` default to live
and are set to `log` only in CI, tests and the parity check. If any of them is
`log` in production, acknowledgements are written to the activity log but
never sent. The deployment readiness list flags this.
