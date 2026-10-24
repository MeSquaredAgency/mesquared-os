# Deploy

## What runs where

- **App**: Next.js 15, deployed from `main`. Any Node host works (Vercel is the
  default assumption); the public URL goes in `NEXT_PUBLIC_APP_URL`.
- **Database**: Neon Postgres, production branch. `DATABASE_URL` is the pooled
  URL, `DATABASE_URL_UNPOOLED` the direct one Prisma uses for migrations.
- **Scheduler**: the Neon `ops` Function with its one-minute trigger, defined in
  `neon.ts`, forwards to `POST /api/jobs/tick` with `JOB_SECRET`.

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
`prisma migrate diff` (the dev command is interactive and not used). To apply
to production:

```bash
set -a; . ./.env.neon.local; set +a
npx prisma migrate deploy
```

`migrate deploy` is additive and safe to re-run. A migration that drops or
renames a column ships in two releases: first add and backfill, then remove
once nothing reads the old column.

## Deploying the app

1. Merge to `main` with CI green.
2. The host builds from `main`. Confirm the environment variables in
   [`.env.example`](../../.env.example) are set; the deployment half of
   **Launch readiness** in the console (`/console/<slug>/settings`) lists the
   ones that are missing.
3. Open `GET /api/v1/health` on the public URL: it reports the data mode
   (`postgres`) and the qualifier engine.
4. Sign in as a platform admin and open the console: the portfolio must list
   the real workspaces, not the demo ones.

## Deploying the Neon branch (Function, trigger, bucket)

```bash
set -a; . ./.env.neon.local; set +a
NEON_PROFILE=agent neon deploy --env .env
npm run neon:check
```

`neon.ts` refuses a production deploy that would leave the tick unforwarded
unless `ALLOW_DEPLOY_WITHOUT_TICK=1` is set. Only set it when the public URL
does not exist yet, and redeploy with tick forwarding as soon as it does.

## Rolling back

- **App**: redeploy the previous build on the host. The app is stateless.
- **Schema**: migrations are forward-only. If a release must come back and its
  migration is incompatible, restore the Neon branch to the point in time
  before the deploy (see [secrets-and-backups.md](secrets-and-backups.md)) and
  redeploy the previous app build against it. Expect to lose writes made in
  between, so do this only for a broken release, never for a bad row.

## Modes that must be off in production

`MESSAGING_MODE`, `SOCIAL_MODE`, `ADS_MODE` and `FINANCE_MODE` default to live
and are set to `log` only in CI, tests and the parity check. If any of them is
`log` in production, acknowledgements are written to the activity log but
never sent. The deployment readiness list flags this.
