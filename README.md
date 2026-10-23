# MeSquared OS

Multi-tenant B2B operations, social marketing and revenue platform. It automates
secondary admin ("red tickets") so clients can focus on revenue drivers ("green
tickets"): stock, high-intent leads and closing.

## Stack

Next.js 15 (App Router, TypeScript) · Tailwind CSS v4 + Radix/shadcn-style UI ·
PostgreSQL + Prisma · Anthropic SDK (lead qualification) · Square, Resend,
Cal.com adapters to follow.

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
Open `/feed` to watch leads arrive.

## Layout

```
docs/product-spec.md             What we are building and for whom (read first)
docs/architecture.md             Domain model, surfaces, module system, phased plan
prisma/schema.prisma             Tenant-scoped data model
src/app/console                  Operator Console: portfolio, queue, workspace drill-in
src/app/app/[tenant]             Client Portal: home, leads, missed opportunities, content, activity
src/app/api/v1/intake            Lead intake: API key → zod → dedupe → qualify → contact → lead → playbook
src/app/api/jobs/detect          Scheduled missed-opportunity detection (JOB_SECRET)
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
- **Roles** (`Membership.role`: OWNER, ADMIN, OPERATOR, MARKETING, VIEWER) gate
  mutations. Marketing can draft; operators and above approve. Platform admins
  act as OWNER everywhere.
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

## Tests and CI

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

That is exactly what `.github/workflows/ci.yml` runs on every push and pull
request, in demo mode (no database or AI key needed). Tests use Node's built-in
runner with type stripping (Node 22.12+; `.nvmrc` pins 24). `src/test/setup.mjs`
resolves the `@/` alias so pipeline modules can be tested unbundled: the suite
covers the classifier, intake schema and phone normalisation, the full intake
pipeline against the in-memory repository (including cross-tenant isolation),
password hashing, session tokens and the sign-in rate limiter.

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

When a lead is green the playbook runs off the `lead.qualified` event: an
acknowledgement with a booking link goes out by SMS, WhatsApp or email
according to the tenant's region (quiet hours apply to non-urgent messages),
the lead is marked responded and "booking link sent", the members holding
`RECEIVE_LEAD_ALERTS` are emailed, and every step is logged for "Handled for
you". Messaging providers are platform-level (Twilio, Resend) but each tenant
sends under its own name, number and reply-to. Set `MESSAGING_MODE=log` to
print instead of send. The SLA watch (`POST /api/jobs/detect`, run it every
few minutes) turns leads that miss the response or booking window into missed
opportunities for an operator.

## Operations

- `GET /api/v1/health` reports data mode and qualifier engine for uptime checks.
- Security headers (nosniff, frame deny, referrer policy, HSTS in production) are
  set in `next.config.ts`.
- Dates render in each tenant's `timezone` and money in its `currency` using its
  `locale` (BCP 47). Set these per tenant; they default to UTC / en-AU / USD.
