# Cloudflare Workers

The app runs on Cloudflare Workers through the OpenNext adapter. This page is
the result of the hosting spike (24 Oct 2026) and the runbook for deploying
there. The Vercel path in [deploy.md](deploy.md) still works unchanged.

## What was proven

Run locally in the real Workers runtime (`wrangler dev`, workerd), the built
worker served the whole app:

- sign-in with scrypt password hashes, signed session cookies, the middleware
- console portfolio, workspace settings, client portal pages
- the intake endpoint end to end (API-key hash lookup, qualification, playbook)
- the scheduler tick across every tenant with scheduled actions running
- Prisma on the wasm query engine through the `pg` driver adapter over TCP,
  against a Postgres database; the Node parity check also passes with the
  same adapter (`DATABASE_DRIVER=pg`), so both drivers exercise one code path
- credential encryption (AES-GCM) and API-key hashing under `nodejs_compat`

Then deployed for real (24 Oct 2026) to the Me² Cloudflare account:
`https://os.mesquaredagency.com (custom domain on the worker; the workers.dev address still answers)`, with Hyperdrive
`mesquared-os-neon` in front of the Neon production branch. Health reports
`postgres`, API-key lookups and the login query run through Hyperdrive, the
tick rejects calls without `JOB_SECRET`, and the minute cron is registered.

**Plan:** the account is on the Workers Free plan. That caps CPU at 10 ms per
request and refuses the `limits.cpu_ms` setting, so the setting is commented
out in `wrangler.jsonc`. Sign-in (scrypt) and the tick need more than 10 ms;
upgrade to Workers Paid ($5 a month) in the dashboard under Workers & Pages →
Plans, then uncomment `limits` and redeploy. Do this before any client uses
the site.

**Credentials on this machine:** `.env.cloudflare.local` (ignored by git)
holds `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; deploy with
`set -a; . ./.env.cloudflare.local; set +a; npm run cf:deploy`. The token
was once committed to GitHub by mistake; after it is removed from the
repository history, rotate it in the dashboard and replace the local file.

## Pieces

| File | Purpose |
|------|---------|
| `wrangler.jsonc` | Worker name, `nodejs_compat`, static assets, self-reference service binding, the minute cron, a 5-minute CPU limit for the tick |
| `open-next.config.ts` | OpenNext adapter config (no incremental cache: every page is per-tenant and dynamic) |
| `cloudflare/worker.ts` | Entry point: OpenNext's fetch handler plus a `scheduled` handler that POSTs the tick to the app with `JOB_SECRET` |
| `src/lib/prisma.ts` | Picks the database driver: Prisma's engine on Node, the `pg` adapter on Workers (or `DATABASE_DRIVER=pg`), the Neon serverless driver with `DATABASE_DRIVER=neon` |
| `next.config.ts` | `.prisma/client` kept external so OpenNext can patch it; `initOpenNextCloudflareForDev()` |

Scripts: `npm run cf:build` (Next build plus the worker bundle), `npm run
cf:preview` (build and run on `http://localhost:8787`), `npm run cf:deploy`.

## Deploying

1. `wrangler login` once on the machine that deploys (or a CI token).
2. Secrets, one at a time, never in `wrangler.jsonc`:

   ```bash
   npx wrangler secret put DATABASE_URL
   ```

   Repeat for `AUTH_SECRET`, `INTEGRATION_ENCRYPTION_KEY`, `JOB_SECRET`,
   `ANTHROPIC_API_KEY`, Twilio, Resend, `GOOGLE_OAUTH_CLIENT_ID` and
   `GOOGLE_OAUTH_CLIENT_SECRET` (Google sign-in) and the webhook secrets listed in
   `.env.example`. Plain values such as `NEXT_PUBLIC_APP_URL`,
   `DEFAULT_FROM_EMAIL` and the `*_MODE` switches go under `vars` in
   `wrangler.jsonc` or through the dashboard.
3. Database connection. Two options:
   - **Hyperdrive (recommended, in place):** `wrangler hyperdrive create
     mesquared-os-neon --connection-string=<Neon pooled URL>` and bind it as
     `HYPERDRIVE` in `wrangler.jsonc`; `src/lib/prisma.ts` prefers the
     binding's connection string on Workers and falls back to the
     `DATABASE_URL` secret. Hyperdrive keeps
     warm connections near the Worker, which matters because each Worker
     request opens its own.
   - **Neon serverless driver:** set `DATABASE_DRIVER=neon` and use the
     plain Neon URL; queries go over HTTP, no pooling to manage.
4. `npm run cf:deploy`. The first deploy prints the `workers.dev` URL; put the
   final public URL in `NEXT_PUBLIC_APP_URL` and redeploy.
5. The cron in `wrangler.jsonc` (`* * * * *`) starts with the deploy. Confirm
   in the dashboard under Triggers, then watch a workspace's activity log for
   automation runs. The Neon `ops` Function is then redundant: remove its
   trigger in `neon.ts` or leave it off.
6. Open `/api/v1/health`: `dataMode` must be `postgres`.

## Local preview

`.dev.vars` (ignored by git) holds the local secrets; `npm run cf:preview`
serves the production build on port 8787. For demo mode add
`DATA_MODE=demo`; for a database set `DATABASE_URL` to the embedded Postgres
(`node scripts/local-postgres.mjs start`).

## Limits and costs to know

- Workers Paid: $5 a month for 10M requests and 30M CPU-ms. The minute tick is
  about 45,000 requests a month on its own; well inside.
- CPU time per request is capped by `limits.cpu_ms` (set to 300,000). The
  tick is mostly waiting on the database and providers, so CPU is small, but
  a workspace with thousands of due actions would need the tick split by
  tenant.
- No TCP from the Worker except through `nodejs_compat` sockets (used by
  `pg`) or Hyperdrive; SMTP is not available, which the app never uses.
- The worker bundle is large (the Prisma wasm engine is included). Builds
  take a few minutes; that is normal.
- The edge runtime (`export const runtime = "edge"`) is not supported by
  OpenNext; the app uses the Node runtime everywhere.

## Rolling back

`npx wrangler rollback` returns to the previous deployment. Database
migrations are forward-only, as in [deploy.md](deploy.md).

## Deploys from GitHub

Since 25 October 2026 every push to `main` that passes CI deploys itself
through `.github/workflows/deploy.yml`: it applies pending Prisma migrations
against the production database first (`DATABASE_URL` repository secret, the
direct Neon connection string) and then builds and uploads the worker
(`CLOUDFLARE_API_TOKEN` secret, `CLOUDFLARE_ACCOUNT_ID` variable). Without the
database secret the run fails before touching the worker, on purpose. Re-run a
failed deploy from the Actions tab once the secret is in place. Rolling the
Cloudflare token means updating that one secret and nothing else.
