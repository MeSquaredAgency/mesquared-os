# MeSquared OS — working notes for agents and engineers

Multi-tenant B2B operations, marketing and revenue platform. Next.js 15 App
Router, TypeScript, Tailwind v4, Prisma/PostgreSQL, zod v4, Anthropic SDK.

**Read first:** `docs/product-spec.md` (what we are building and for whom) and
`docs/architecture.md` (domain model, surfaces, phased plan). The spec
supersedes the first-build dashboard: the equal-column green/red board, the
manual compose box, stock as a core concept and the Square home-screen feed are
being replaced. Clients never see "green" or "red"; they see "Needs you",
"Handled for you" and "Recovered".

## Non-negotiables

- **Tenant isolation.** Every operational row carries `tenantId`. All reads and
  writes go through the `Repository` interface in `src/lib/data/repository.ts`;
  every method takes a tenant id and must never return another tenant's rows.
  Add new data access there, in both `prisma-repository.ts` and `memory.ts`.
- **No client-specific code.** No client names, branding, keys or rules in
  source. They live on `Tenant` (branding, qualificationRules, settings) and the
  integration tables. Demo fixtures use fictional businesses only.
- **Demo mode must keep working.** With `DATABASE_URL` unset the app runs on
  in-memory fixtures (`src/lib/data/fixtures.ts`); with `ANTHROPIC_API_KEY`
  unset the classifier is the rule stub. CI runs in demo mode.
- **Secrets.** API keys are stored as SHA-256 hashes, passwords as scrypt. Never
  log raw keys, passwords or lead payloads; store payloads only via `redactPayload`.
- **Roles.** Any server action that mutates tenant data calls `requireRole` /
  `atLeast` from `src/lib/auth/roles.ts` with the role on `tenant.role`.
- **Client components get `TenantOption`, never `TenantSummary`.** Rules,
  settings and branding internals stay on the server.
- **Neon services are optional.** Postgres, the AI Gateway, Object Storage and
  Realtime are detected with `neonServices()` in `src/lib/neon.ts`; every
  integration degrades when its variables are missing. Never put a `NEON_*` or
  `AWS_*` value, a sealed query or a presigned URL into a log.

## Commands

```bash
npm run dev          # http://localhost:3000, demo mode unless DATABASE_URL is set
npm run typecheck && npm run lint && npm test && npm run build   # what CI runs
npm run db:migrate && npm run db:seed                            # with Postgres
neon deploy --env .env && npm run neon:check                     # provision the Neon branch, prove each service
```

Tests use Node's built-in runner with type stripping (`src/test/*.test.ts`).
Modules under test import with the `@/` alias via `src/test/setup.mjs`; keep
tested modules free of `next/*` imports and JSX.

## Where things live

- `src/app/console` — Operator Console (portfolio, queue, drill-in); `src/app/app/[tenant]` — Client Portal
- `src/lib/auth/access.ts` — `getConsoleContext` / `getPortalContext` resolve the user and their permissions; every page starts there
- `src/lib/templates` — industry templates; applying one is the only way a tenant gets configured
- `src/lib/modules`, `src/lib/automations` — registries of module keys and automation types
- `src/lib/opportunities/detect.ts` — SLA detectors; `POST /api/jobs/tick` (`src/lib/jobs/tick.ts`) runs them together with due scheduled actions, every minute
- `src/lib/messaging` — the only place outbound policy lives: destination allow-list, consent by region, quiet hours, daily caps; every automated send goes through `sendMessage`
- `src/lib/events` — `emit()` appends to the tenant stream and runs subscribers
- `src/lib/intake` — intake schema and pipeline; `src/lib/qualify` — classifier
- `src/lib/data` — repository contract with Prisma and in-memory implementations
- `src/lib/copy.ts` — the only place client-facing words for green/red live
- `src/lib/content` — the content engine: `compliance.ts` (brand + compliance block, enforced on every asset), `generate.ts` (Claude or the stub), `calendar.ts` (slots, gaps), `engine.ts` (material → drafts → approval → calendar), `actions.ts` (server actions)
- `src/lib/ads` (spend sync + pacing), `src/lib/attribution` (tracked links, the CPL/CPA/ROAS report), `src/lib/finance` (connectors, invoice reminders, webhooks), `src/lib/website` (beacon roll-up); `src/lib/money/actions.ts` — operator actions; `ADS_MODE=log` / `FINANCE_MODE=log` simulate
- `src/lib/tenants/provision.ts` — the only way a workspace, member or API key is created; `src/lib/tenants/actions.ts` — the console's server actions; `src/lib/launch/readiness.ts` — the launch checks shown in settings; `src/lib/inventory` — CSV import, listing lookup for replies, drafts on new listings
- `docs/runbooks/` and `docs/launch-checklist.md` — how it is run and what "ready" means
- `src/lib/social` — publishing (`publish.ts`), inbox + triage (`inbox.ts`), analytics (`metrics.ts`), hourly sync, encrypted channel credentials; `providers/` holds one adapter per platform behind `SocialProvider`; `SOCIAL_MODE=log` simulates everything
- `neon.ts` — Neon branch config (AI Gateway, `assets` bucket, `ops` Function with its minute trigger, Realtime); `neon/functions/ops.ts` is the Function
- `src/lib/neon.ts` — which Neon services are configured; `src/lib/storage.ts` — tenant-prefixed object storage; `src/lib/realtime` — sealed live queries

## Conventions

- Server components by default; add `"use client"` only for interactivity.
- Client components that hold per-tenant state are keyed by `tenant.id`.
- Dates render in the tenant's timezone and money in the tenant's currency via
  `src/lib/utils.ts` helpers; never call `toLocale*` without a timezone.
- Commit messages: conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`).
