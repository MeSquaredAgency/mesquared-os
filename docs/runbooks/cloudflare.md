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

**Plan:** the account has been on Workers Paid since 24 October 2026, so
`limits.cpu_ms` (300 s) and Smart Placement in `wrangler.jsonc` are active.
Sign-in (scrypt) and the tick need far more than the Free plan's 10 ms.

**Credentials:** deploys run from GitHub Actions with the `CLOUDFLARE_API_TOKEN`
repository secret (see "Deploys from GitHub" below); no token is needed on a
laptop. For an emergency deploy by hand, `.env.cloudflare.local` (ignored by
git) can hold `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; deploy with
`set -a; . ./.env.cloudflare.local; set +a; npm run cf:deploy`. A token was
once committed to GitHub by mistake (commit `5c9a638`); it was rolled on
25 October 2026, so the value in history is dead.

## Pieces

| File | Purpose |
|------|---------|
| `wrangler.jsonc` | Worker name, `nodejs_compat`, static assets, self-reference service binding, the minute cron, a 5-minute CPU limit for the tick |
| `open-next.config.ts` | OpenNext adapter config (no incremental cache: every page is per-tenant and dynamic) |
| `cloudflare/worker.ts` | Entry point: OpenNext's fetch handler plus a `scheduled` handler that POSTs the tick to the app with `JOB_SECRET` |
| `src/lib/prisma.ts` | Picks the database driver: Prisma's engine on Node, the `pg` adapter on Workers (or `DATABASE_DRIVER=pg`), the Neon serverless driver with `DATABASE_DRIVER=neon`. On Workers the client and its pool belong to one request (see "Database connections" below) and read queries retry transient connection failures |
| `src/instrumentation.ts` | `onRequestError`: logs every server error that reaches an error boundary as `[request-error]` with the route, the digest shown to the person and the real message |
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

## Database connections

A Workers socket may only be used by the request that opened it. A `pg` pool
shared by every request in an isolate hands a connection opened for one page
to the next page (the browser prefetches every sidebar and tab link, so several
requests run at once) and fails with `Cannot perform I/O on behalf of a
different request`, or loses the connection when the first request finishes.
That was the usual cause of "This page didn't load" (31 October 2026).

So on Workers `getPrisma()` returns a client per request, keyed on OpenNext's
request context (an AsyncLocalStorage store, new for each request) and
dropped with it: a pool of five connections through Hyperdrive, a ten-second
connect timeout so a hung connect fails instead of hanging the page, and idle
connections closed after five seconds. Read queries (`findMany`, `count`,
`aggregate`, …) retry up to three times on a transient failure (dropped
socket, pooler closed the connection, database restarting; the list is in
`src/lib/data/transient.ts`), each retry logged as `[db] retrying …`. Writes
are never retried: a create that reached the server before the socket dropped
must not run twice.

The console and portal error boundaries retry a failed page once by
themselves (at most once per error every 30 seconds) before showing the
message and the reference.

## Reading the logs

Observability is on for the worker, so the dashboard keeps logs: Workers &
Pages → `mesquared-os` → Logs. Search for `[request-error]` to see every page
or action that failed, with the route and the real message (Next.js only
shows the person a digest); searching for the digest from the "Reference"
line on the error page finds the one failure they saw. `[db] retrying` shows
connection failures that were absorbed; many of them in a short time mean
Hyperdrive or Neon is struggling even though pages still load.

`npx wrangler tail mesquared-os --status error` streams live errors. It needs
a token with Workers Tail permission (or `wrangler login`); the token in
`.env.cloudflare.local` on the laptop is the rolled one from October 2026 and
no longer authenticates, so replace it before relying on it.

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
