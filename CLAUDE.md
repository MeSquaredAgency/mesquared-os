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

## Commands

```bash
npm run dev          # http://localhost:3000, demo mode unless DATABASE_URL is set
npm run typecheck && npm run lint && npm test && npm run build   # what CI runs
npm run db:migrate && npm run db:seed                            # with Postgres
```

Tests use Node's built-in runner with type stripping (`src/test/*.test.ts`).
Modules under test import with the `@/` alias via `src/test/setup.mjs`; keep
tested modules free of `next/*` imports and JSX.

## Where things live

- `src/app/api/v1/intake` — lead intake: API key → zod → dedupe → qualify → route
- `src/lib/qualify` — Green/Red classifier (rule stub + Anthropic engine)
- `src/lib/intake` — intake schema and pipeline
- `src/lib/auth` — passwords, signed session cookie, sign-in actions, rate limit
- `src/lib/tenant` — API-key resolution for inbound requests; current workspace
- `src/app/(dashboard)` — operator UI; `src/components/dashboard` — its parts
- `prisma/schema.prisma` — the data model; `prisma/seed.ts` — demo tenants

## Conventions

- Server components by default; add `"use client"` only for interactivity.
- Client components that hold per-tenant state are keyed by `tenant.id`.
- Dates render in the tenant's timezone and money in the tenant's currency via
  `src/lib/utils.ts` helpers; never call `toLocale*` without a timezone.
- Commit messages: conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`).
