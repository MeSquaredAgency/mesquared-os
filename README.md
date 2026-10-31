# MeSquared OS

Multi-tenant B2B operations, social marketing and revenue platform. It automates
secondary admin ("red tickets") so clients can focus on revenue drivers ("green
tickets"): stock, high-intent leads and closing.

## Stack

Next.js 15 (App Router, TypeScript) · Tailwind CSS v4 + Radix/shadcn-style UI ·
Neon (Lakebase Postgres + Prisma, AI Gateway, Object Storage, Functions,
Realtime) · Anthropic SDK (lead qualification) · Square, Resend, Cal.com
adapters to follow.

## Run it

```bash
npm install
cp .env.example .env
npm run dev
```

Without `DATABASE_URL` the app runs in **demo mode** against in-memory fixtures
(two fictional tenants), so the dashboard and intake endpoint work with no
infrastructure. With `DATABASE_URL` set:

```bash
npm run db:migrate   # creates the schema
npm run db:seed      # two tenants + one API key each (printed once)
```

Without `ANTHROPIC_API_KEY` the qualifier is the deterministic rule-based stub in
`src/lib/qualify/rules.ts`. With it set, `src/lib/qualify/anthropic.ts` runs
Claude with structured output and falls back to the stub on any API error.

## Sign in

One sign-in for two surfaces. Me² operators land in the **Operator Console**
(`/console`): a portfolio of every workspace they are assigned to, with health,
SLA breaches, missed opportunities, the exception queue, content due, ad pacing
and integration status, plus a drill-in per workspace. Client users land in the
**Client Portal** (`/app/<workspace>`): "Needs you", missed opportunities with
money at risk and recovered, money (if they may see it), content waiting for
their approval, and the "Handled for you" summary.

Permissions are fixed (`VIEW_FINANCES`, `APPROVE_CONTENT`, `RECEIVE_LEAD_ALERTS`,
`MANAGE_USERS`, `VIEW_ALL_RECORDS`); role names are set per tenant and seeded
from the industry template (real estate names them Director, Region Manager,
Property Manager, External accountant).

- **Demo mode:** every account below signs in with `DEMO_OPERATOR_PASSWORD`
  (default `mesquared-demo`):
  - `operator@example.com` — platform admin, console, every workspace
  - `ops@example.com` — operator assigned to both demo workspaces
  - `director@harbor.example` — Harbor Realty Director (portal, all permissions)
  - `pm@harbor.example` — Harbor Realty Property Manager (portal, own leads only)
  - `owner@summit.example` — Summit Health & Fitness Owner (portal)
- **With a database:** `npm run db:seed` applies the real-estate and
  health-and-fitness templates to two fictional tenants and prints the
  passwords and API keys once (or set `SEED_OPERATOR_PASSWORD`).

## Try the intake endpoint

Demo-mode key for the first tenant: `msq_live_demo_one_0000000000000000`.

```bash
curl -s -X POST http://localhost:3000/api/v1/intake \
  -H "Authorization: Bearer msq_live_demo_one_0000000000000000" \
  -H "Content-Type: application/json" \
  -d '{"source":"META_LEAD_FORM","name":"Margaret Ellis","email":"m@example.com","phone":"+61400000000","message":"Interested in dental implants, consult this week","fields":{"budget":"$4,000","timeline":"this week"}}'
```

A GREEN result creates a booking link and an urgent follow-up task; a RED
result queues a nurture task. Add `"dryRun": true` to classify without storing.
Open `/console` to watch leads arrive.

## Layout

```
docs/product-spec.md             What we are building and for whom (read first)
docs/architecture.md             Domain model, surfaces, module system, phased plan
prisma/schema.prisma             Tenant-scoped data model
src/app/console                  Operator Console: portfolio, queue, workspace drill-in
src/app/app/[tenant]             Client Portal: home, leads, missed opportunities, content, activity
src/app/api/v1/intake            Lead intake: API key → zod → dedupe → qualify → contact → lead → playbook
src/app/api/jobs/tick            Scheduler tick: missed-opportunity detectors + due scheduled actions (JOB_SECRET)
src/app/book/[tenant]            Platform booking fallback page (Cal.com when connected, otherwise a callback request)
src/lib/templates                Industry templates (real estate, health & fitness, generic)
src/lib/modules, src/lib/automations   Module and automation registries
src/lib/opportunities            Missed-opportunity detectors
src/lib/events                   Tenant event stream with in-process subscribers
src/lib/qualify                  Green/Red classifier (rule stub + Anthropic engine)
src/lib/auth                     Passwords, sessions, permissions, access resolution
src/lib/data                     Tenant-scoped repository (Prisma or in-memory demo)
src/components/{shell,console,portal}   UI for the two surfaces
```

## Security model

- **Operator sessions** are HMAC-signed cookies carrying the user id, the
  original sign-in time and the user's `sessionVersion`. They renew while in use
  (7-day TTL) up to a 30-day absolute maximum, and bumping `sessionVersion`
  signs the user out everywhere. Sign-in is rate limited per IP and per
  (IP, email), with a growing delay per email so an attacker cannot lock an
  operator out just by knowing their address.
- **Roles** are per-workspace `TenantRole` rows with explicit permissions
  (view finances, approve content, receive lead alerts, manage users, view all
  records), created from the industry template and gated with
  `requirePermission` in the portal. Me² operators act with every permission
  inside the workspaces assigned to them; platform admins everywhere.
- **Intake** is authenticated by hashed tenant API keys, rate limited per
  workspace, capped at 64 KB, bounded to 30 scalar `fields`, and deduped before
  the classifier runs so retries never cost a model call. Raw payloads are
  redacted (passwords, card numbers, government ids) and stored once on
  `IntakeEvent`. The AI qualifier treats lead text as untrusted data, derives
  the ticket from the score, clamps its reason, and cannot promote a lead the
  rule engine finds signal-less.
- **Every relational write** (task, booking, intake event) verifies the
  referenced lead belongs to the tenant and throws otherwise; lead creation is
  race-safe on the `(tenantId, externalId)` unique index.
- **Production guards:** the app refuses to start in demo mode, with a default
  demo password, without `AUTH_SECRET`, or (for booking links) without
  `NEXT_PUBLIC_APP_URL`; the seed refuses to run against production.

## Multi-tenancy rules

- Every operational row carries `tenantId`; every repository method takes a tenant id.
- No client names, branding or keys in code. Branding, qualification rules and
  integration credentials live on the tenant's rows.
- Inbound API keys are stored as SHA-256 hashes; the raw key is shown once at creation.

## Local PostgreSQL without installing anything

`npm run db:local` starts an embedded PostgreSQL (binaries downloaded into
`node_modules`, data in `.pg/`, no admin rights needed) on port 54329 and
prints its connection string. Then:

```bash
export DATABASE_URL=postgresql://postgres:postgres@localhost:54329/mesquared_os
export DATABASE_URL_UNPOOLED=$DATABASE_URL   # separate line: zsh leaves it empty when combined with the one above
npm run db:migrate && SEED_OPERATOR_PASSWORD=choose-one npm run db:seed
MESSAGING_MODE=log npm run db:parity   # real flows against the Prisma repository
```

For a shared or hosted database use Neon (see [Neon services](#neon-services)):
`neon deploy` writes the pooled string to `DATABASE_URL` and the direct one to
`DATABASE_URL_UNPOOLED`, which Prisma Migrate uses.

## Neon services

The hosted backend is a Neon project: `.neon` links this checkout to it and
`neon.ts` declares what every branch gets. One command provisions the branch
and writes its credentials into `.env` (create it from `.env.example` first,
without the two local `DATABASE_URL*` lines):

```bash
npm i -g neon            # once; then `neon login`
neon deploy --env .env   # apply neon.ts to the linked branch and pull its env vars
npx prisma migrate deploy && npm run db:seed
npm run neon:check       # proves each configured service end to end
```

To keep other local runs in demo mode, deploy with `--no-env-pull` and pull
into a file Next.js does not auto-load, then source it when you need it:
`neon env pull --file .env.neon.local` (gitignored; `npm run neon:check` reads it).

| Service | Env vars (written by `neon deploy`) | Where it is used |
|---|---|---|
| Lakebase Postgres | `DATABASE_URL` (pooled), `DATABASE_URL_UNPOOLED` | Prisma: the app queries through the pooler, Migrate uses the direct string (`prisma/schema.prisma`) |
| AI Gateway (off) | `NEON_AI_GATEWAY_BASE_URL`, `NEON_AI_GATEWAY_TOKEN` | Disabled in `neon.ts`: lead qualification uses a direct `ANTHROPIC_API_KEY`. The gateway path in `src/lib/qualify` stays; set `aiGateway: true` (paid Neon plan) to use it |
| Object Storage | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`, `AWS_REGION` | Private bucket `assets`: `POST /api/v1/assets` (tenant API key, multipart `file`) stores under `tenants/<id>/…` and creates a `ContentAsset`; every read is a presigned URL (`src/lib/storage.ts`, portal content page, `GET /api/v1/assets/:id`) |
| Functions | injected on the function | `ops` (`neon/functions/ops.ts`): `GET /` reports database status next to the data; `POST /tick` receives the one-minute trigger and forwards `POST /api/jobs/tick` once `NEXT_PUBLIC_APP_URL` is a public URL and `JOB_SECRET` is in `.env` at deploy time |
| Realtime | `NEON_REALTIME_URL`, `NEON_REALTIME_SECRET` | The portal's lead list is a live, tenant-scoped query sealed on the server (`src/lib/realtime`, renewed via `POST /api/v1/live/leads`); the secret never reaches the browser |

Everything degrades: with a variable unset the app falls back (demo data, the
rule qualifier, no uploads, a static list) and `GET /api/v1/health` reports
`services` and `qualifier` so you can see what a deployment has. Functions,
Object Storage, the AI Gateway and Realtime need the project in one of Neon's
supported AWS regions; the AI Gateway also needs a paid plan. Pass
`--function-url <invocation url>` (from `neon functions get ops`) to
`npm run neon:check` to exercise the Function too.

## Tests and CI

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

That is what the first CI job runs on every push and pull request, in demo
mode. A second job starts PostgreSQL, applies the migrations, seeds both
tenants from templates and runs `npm run db:parity`, so the Prisma repository
is exercised on every change too. Tests use Node's built-in
runner with type stripping (Node 22.12+; `.nvmrc` pins 24). `src/test/setup.mjs`
resolves the `@/` alias so pipeline modules can be tested unbundled: the suite
covers the classifier, intake schema and phone normalisation, the full intake
pipeline against the in-memory repository (including cross-tenant isolation),
password hashing, session tokens and the sign-in rate limiter, plus one file
per later phase (bookings and automations, content and social, money,
provisioning and inventory, Google sign-in, and the regression tests for the
October 2026 review in `review-fixes.test.ts` and `review-medium.test.ts`).

## Intake channels and the playbook

Every channel ends in the same pipeline (dedupe → qualify → contact → lead →
playbook), so a lead looks the same whether it came from a form, an ad or an
email.

| Channel | Endpoint | How a tenant is matched |
|---|---|---|
| JSON API / relays | `POST /api/v1/intake` | API key header |
| Plain HTML forms, Google Ads landing pages | `POST /api/v1/intake/form` (urlencoded or multipart; hidden `_key`, honeypot `_hp`, optional `_redirect`; UTMs and click ids become attribution) | API key |
| Meta lead forms | `GET/POST /api/v1/webhooks/meta` (handshake + signed leadgen events, Graph fetch) | page id on the tenant's META integration |
| Forwarding inbox (REA, Domain, anything) | `POST /api/v1/inbound/email` (generic inbound-webhook JSON) | recipient address on the tenant's EMAIL_FORWARDING integration |
| Cal.com bookings | `POST /api/v1/webhooks/calcom` (signed) | `metadata[tenant]` + `metadata[leadId]` on the booking |
| Twilio inbound SMS | `POST /api/v1/inbound/sms` (signature-checked with `TWILIO_AUTH_TOKEN`; STOP/UNSUBSCRIBE withdraws SMS consent, START restores it) | the tenant's number |
| Missed calls | `POST /api/v1/inbound/call` (tenant API key required; the business number is no longer accepted as a credential) | API key |
| Booking fallback | `/book/[tenant]?lead=…` forwards to Cal.com when connected, otherwise takes a callback request | tenant slug |

When a lead is green the playbook runs off the `lead.qualified` event: an
acknowledgement with a booking link goes out by SMS, WhatsApp or email
according to the tenant's region (quiet hours apply to non-urgent messages),
the lead is marked responded and "booking link sent", the members holding
`RECEIVE_LEAD_ALERTS` are emailed, and every step is logged for "Handled for
you". Messaging providers are platform-level (Twilio, Resend) but each tenant
sends under its own name, number and reply-to. Set `MESSAGING_MODE=log` to
print instead of send. The scheduler tick (`POST /api/jobs/tick`, run it every
minute) runs the SLA watch that turns leads which miss the response or booking
window into missed opportunities for an operator, then the due scheduled
actions; there is no separate detect route.

## Missed opportunities and automations

The scheduler tick (`POST /api/jobs/tick`, bearer `JOB_SECRET`, run it every
minute) does two things for every active tenant: runs the detectors, then
executes any scheduled work whose time has come.

Detectors (values and thresholds per tenant, one open item per subject):
unanswered enquiries and leads that never booked (SLA), no-shows, quotes or
proposals gone quiet (stages with `quietAfterDays`), unreplied DMs and
comments, unanswered reviews, lapsed customers, abandoned forms (via the
`/api/v1/track/form` beacon), and missed calls (via `/api/v1/inbound/call`).
Each raises an exception for an operator, or for the client person a tenant's
escalation rule names, logs a run, and emits an event.

Automation types with handlers: enquiry auto-reply (green playbook, the
renter/availability reply for red enquiries, a text back after a missed call),
booking lifecycle (confirmation, reminder, auto-complete, follow-up; cancelled
or rescheduled bookings drop their queued work), review requests after a
completed appointment (needs `reviewUrl` in the tenant's settings), chasing
documents or information with a cap then escalation, and reactivation of
lapsed customers (respecting recorded consent). Operators drive outcomes from
the workspace page in the console: attended / no-show, open or close a
request, mark a review replied.

## Content engine and social

Phase 3. Everything runs in demo mode with simulated publishing (`SOCIAL_MODE=log`) and the
deterministic drafting stub; add `ANTHROPIC_API_KEY` for Claude drafts and connect a channel in
the console to publish for real.

**Material in.** Operators paste notes, transcripts or reviews in the console ("Material"), push
them with `POST /api/v1/content/sources` (needs an API key with the `content` scope; the
public intake key is refused), or upload files with `POST /api/v1/assets` (same scope). Good
reviews (4+ stars, with text) become material automatically. Recordings are transcribed when
`DEEPGRAM_API_KEY` is set; otherwise the console says to paste the transcript.

**Drafts out.** One draft per connected channel, shaped per platform (caption, short-form
script, YouTube title + description), run through the brand profile and compliance block:
banned phrases and hype block approval; prices, named people, outcome claims and old figures
need the client's sign-off; the required footer is applied to every asset; two properties in
one asset are refused where the tenant forbids combining vendors.

**Approval → calendar.** Operators approve routine drafts in the console; drafts flagged for
the client are approved in the portal. Approval creates a scheduled post at the next free slot
from the tenant's posting slots (`content` module settings). The daily batch drafts from unused
material and raises an exception when the next seven days fall short of the cadence.

**Publishing.** The tick publishes due posts through the platform adapters (Facebook, Instagram,
Google Business Profile, LinkedIn, YouTube, TikTok) with claim-once semantics, three attempts
with backoff, and an exception after that. Channel tokens are pasted in the console and stored
encrypted on the tenant's integration row.

**Inbox and analytics.** The hourly sync (and the Meta webhook) pulls comments, messages and
reviews into one inbox. Triage drafts a reply, flags complaints and enquiries for a person, and
answers routine thanks only when the tenant switches `autoReplyRoutine` on. Channel numbers
(followers, reach, engagements) are snapshotted daily and summarised in the portal.

## Money: ads, attribution, finance, website

Phase 4. All of it runs in demo mode (`ADS_MODE=log`, `FINANCE_MODE=log`) on the fixtures.

**Ad spend and pacing.** Operators connect Meta and Google Ads accounts in the console (read-only
tokens, encrypted on the account row). A daily job pulls spend per campaign per day; each account
carries a monthly budget and the month is checked against it. More than 25% over or under plan
raises one exception for an operator (threshold in the `ads_sync` automation settings).

**Attribution.** Leads keep the UTMs they arrive with. Tracked links (`/r/<code>`, made in the
console) redirect with UTMs stamped on, count clicks, and drop a first-party cookie so a form
filled later still carries the campaign. The report (portal Money page, last 30 days) groups
leads by source and campaign, joins ad spend by campaign name, and shows cost per lead, cost per
won deal and revenue per dollar.

**Finance.** Read-only connectors for Xero, Square and Stripe pull payments, expenses and
invoices daily; Square and Stripe also push through per-workspace webhooks
(`/api/v1/webhooks/<provider>/<integrationId>`, signature-checked with the tenant's own secret).
The `payment_reminders` automation reminds before the due date, chases overdue invoices on a
schedule, then hands the last one to a person. The Money panel shows revenue, profit after
expenses and ads, what is owed and what is overdue.

**Website.** A beacon (`POST /api/v1/track/page`, intake key) records page views, form starts
(from the form beacon) and submissions (from the form endpoint). A daily roll-up turns them into
visits, top pages, where visitors came from, and form conversion; raw events are pruned after
35 days.

## Setting up a client (Phase 5)

A client is configuration applied to a template. Platform admins create a
workspace at `/console/new` (template, name, region preset, sender details,
compliance line) and land in `/console/<slug>/settings`, which holds:

- **Launch readiness**: required, recommended and optional checks for the
  workspace and for the deployment, each with the reason in plain words.
- **Business**: service levels, qualification rules, brand voice, banned
  phrases, the compliance footer and claims policy.
- **People**: invite with a role; new accounts get a one-time password shown
  once; reset, remove, assign a Me² operator.
- **API keys**: issue scoped keys (`intake` for forms, calls and reviews;
  `content` for uploads), shown once, revocable. Last use is tracked.
- **Modules & automations**, **Escalation & values**, and **Inventory** (CSV
  import; new active listings become content material and enquiries that
  name a listing get its details in the automatic reply).

The portal gains `/app/<slug>/inventory` when the inventory module is on.
Listings can also come straight from the client's property management
software: the `PROPERTY_MANAGEMENT` integration names the vendor (PropertyMe
today, `src/lib/inventory/providers/`) and holds its encrypted token; the
daily `inventory_sync` automation pulls the rent roll and vacancies.
`INVENTORY_MODE=log` simulates it with two sample listings.

Messages can be signed by the person a lead is assigned to (Settings →
Business → "Sign messages as the person assigned to the lead"): their first
name goes in the sign-off and replies go to their email, while the business
name, number and sending domain stay the same. Unassigned leads are signed by
the business.

Real workspaces are provisioned from a JSON definition kept outside the
repository (`tenants/` is ignored): `npm run tenant:provision -- tenants/<slug>.json`
creates or refreshes the workspace, its people, operators and platform admins
against whatever `DATABASE_URL` points at, and never prints a password.
Everything is a repository method, so it runs identically in demo mode and on
Postgres; `npm run db:parity` provisions a throwaway workspace to prove it.
Runbooks live in `docs/runbooks/` and the launch gate is
`docs/launch-checklist.md`.

New clients usually start with the online onboarding questionnaire: Console →
**Onboarding** makes a private link (`/onboarding/<token>`, no account
needed, about ten minutes, saves as they go), the operator completes the
**call sheet** during the intake call, and **Create workspace** provisions
from both with a review list of what still needs a person. A client who filled in the Claude Docs version instead goes through
`npm run tenant:from-questionnaire -- <file.md>`, which drafts the same
definition into `tenants/<slug>.json` (`docs/runbooks/onboarding-questionnaire.md`).

## Hosting on Cloudflare Workers

The app also builds for Cloudflare Workers through the OpenNext adapter:
`npm run cf:build`, `npm run cf:preview` (production build on port 8787 in
the real Workers runtime, secrets from `.dev.vars`), `npm run cf:deploy`.
`src/lib/prisma.ts` switches to the `pg` driver adapter on Workers (or with
`DATABASE_DRIVER=pg`), and `cloudflare/worker.ts` adds the minute cron that
runs the scheduler tick. See `docs/runbooks/cloudflare.md`.

## Operations

- `GET /api/v1/health` reports data mode and qualifier engine for uptime checks.
- Security headers (nosniff, frame deny, referrer policy, HSTS in production) are
  set in `next.config.ts`.
- Dates render in each tenant's `timezone` and money in its `currency` using its
  `locale` (BCP 47). Set these per tenant; they default to UTC / en-AU / USD.
