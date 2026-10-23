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

The dashboard is behind email-and-password sign-in. Sessions are signed HttpOnly
cookies (`AUTH_SECRET`), passwords are scrypt-hashed, and sign-in is rate limited
to five failures per 15 minutes per email.

- **Demo mode:** `operator@example.com` with `DEMO_OPERATOR_PASSWORD` (default
  `mesquared-demo`). A second user, `marketing@example.com`, sees only the first
  workspace, to exercise membership scoping.
- **With a database:** `npm run db:seed` creates `operator@example.com` and prints
  its password once (or set `SEED_OPERATOR_PASSWORD`).

Which workspaces a user can switch between comes from `Membership` rows; platform
admins see every active tenant. Inbound API routes use tenant API keys, not sessions.

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
prisma/schema.prisma          Tenant, User, Membership, TenantApiKey, Lead, IntakeEvent,
                              Task (GREEN|RED), StockItem, SquareIntegration, Transaction,
                              Booking, SocialConnection, ContentAsset, SocialPost, SocialProofAsset
src/app/(dashboard)/          Operator dashboard: tickets, marketing workbench, live feed
src/app/api/v1/intake         Lead intake endpoint (auth → validate → dedupe → qualify → route)
src/app/api/v1/webhooks/*     Square + social lead-form webhook stubs
src/lib/qualify/              Green/Red classifier (rule stub + Anthropic engine)
src/lib/data/                 Tenant-scoped repository (Prisma or in-memory demo)
src/lib/auth/                 Passwords (scrypt), signed session cookies, sign-in actions, rate limit
src/middleware.ts             Redirects unauthenticated dashboard requests to /login
src/lib/tenant/               API-key auth for inbound requests; cookie-based workspace switch
src/components/dashboard/     Dashboard UI
```

## Multi-tenancy rules

- Every operational row carries `tenantId`; every repository method takes a tenant id.
- No client names, branding or keys in code. Branding, qualification rules and
  integration credentials live on the tenant's rows.
- Inbound API keys are stored as SHA-256 hashes; the raw key is shown once at creation.

## Tests

```bash
npm test
```

Runs the qualifier tests with Node's built-in test runner (Node 22.6+ with type
stripping; Node 24 recommended).
