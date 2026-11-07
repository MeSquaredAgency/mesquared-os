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
- **Roles.** Console actions resolve the tenant from the caller's portfolio via
  `getConsoleContext` (never from the client); portal actions call
  `requirePermission` / `hasPermission` from `src/lib/auth/permissions.ts`.
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

- `src/app/console` — Operator Console (portfolio, queue, drill-in, a workspace's agent runs at `[tenant]/agents`); `src/app/app/[tenant]` — Client Portal
- `src/lib/auth/access.ts` — `getConsoleContext` / `getPortalContext` resolve the user and their permissions; every page starts there
- `src/lib/tasks` and `src/lib/chat` — work between the client and Me². A task has an owner side (`ME2` or `CLIENT`), an optional assignee and deadline, and an activity log (`TaskEvent`) written by `planTaskEdit`; the tick's `remindDueTasks` sends one "due soon" email a day before and one "overdue" email per deadline (claimed first, so overlapping ticks never double-send) and puts an overdue Me² task in the operator queue. The chat is one thread per workspace; `chat/crypto.ts` encrypts every message (AES-256-GCM, bound to workspace and message id) under a key from `CHAT_ENCRYPTION_KEY` or derived from `INTEGRATION_ENCRYPTION_KEY`. It is encryption at rest, not end-to-end. Alerts go by browser and phone notification first (`src/lib/push`: Web Push built on Web Crypto, RFC 8291 encryption and VAPID signing, so it runs on Workers; `public/sw.js` shows them; `app/manifest.ts` makes the OS installable, which iPhones need), and by email only to people with no device turned on. Alerts say who wrote, never what. VAPID keys come from `npm run push:keys`; without them production sends email only. App mode (installed to a Home Screen): `app/manifest.ts` and `public/icons/*` (any and maskable); the status bar colour is the `viewport.themeColor` of the root layout (paper) and the console layout (navy); the shell pads itself with `env(safe-area-inset-*)`; `public/sw.js` answers a failed page load with `public/offline.html` and caches nothing else; `shell/install.tsx` is the install banner (Android one-tap via `beforeinstallprompt`, captured in the page head by `lib/install-script.ts`; iPhone gets the Share steps); `shell/pull-to-refresh.tsx` only runs when installed; mark a scroll box `data-no-pull` to keep pulls inside it. Phone inputs are 16px so iOS never zooms on focus. `src/lib/collab/people.ts` decides who is on each side. Screens are shared by portal and console (`src/components/collab/screens.tsx`)
- `src/lib/templates` — industry templates; applying one is the only way a tenant gets configured
- `src/lib/modules`, `src/lib/automations` — registries of module keys and automation types; `moduleOn(config.modules, key)` is the one way to ask whether a module is on, and every portal page or email that belongs to a module (opportunities, inventory) must check it
- `src/lib/opportunities/detect.ts` — SLA detectors; `raise.ts` opens an item and escalates it (only to a current member); `reconcile.ts` closes items as RECOVERED when the person comes back (enquiry, reply, booking, payment); `expire.ts` is the daily sweep that writes off items older than `sla_watch.expireAfterDays` (default 30); `POST /api/jobs/tick` (`src/lib/jobs/tick.ts`) runs the detectors with bounded concurrency and a budget, then due scheduled actions with exponential backoff, every minute. Throw `NonRetryableError` from a handler for a step that can never succeed
- `src/lib/scheduling/callback.ts` — a lead asking to be called back; `/book/[tenant]` is the platform's own booking page when Cal.com is not connected, and a request there settles the response clock (the queue item is the reminder to call)
- `src/lib/messaging` — the only place outbound policy lives: destination allow-list, explicit opt-outs (final on every channel), consent by region, quiet hours, daily caps; every automated send goes through `sendMessage`; `keywords.ts` decides what counts as STOP/START; `MESSAGING_STAFF_NUMBERS` (a deployment secret) lists Me² mobiles any workspace may text, for testing from abroad, and `MESSAGING_STAFF_FROM_NUMBER` is the platform number used as the sender to them (a workspace's local number usually cannot reach another country); a failed acknowledgement text falls back to email when the lead left one
- `src/lib/events` — `emit()` appends to the tenant stream and runs subscribers; a subscriber that throws is logged and, once an hour per kind, becomes an exception in the queue
- `src/lib/intake/channels/meta-lead.ts` — one Meta lead form submission through intake, with a queued retry (`meta_lead:fetch`) when Graph does not answer
- `src/lib/health.ts` — the portfolio health score and its breakdown in words; `src/lib/portal/actions.ts` — the client's own actions ("I've called them"); `src/lib/pipelines/advance.ts` — stages move on attended appointments and payments
- `src/lib/log.ts` — `log(level, event, fields)` writes one JSON line for the scheduler and event paths; fields are ids, counts and short messages, never payloads or secrets
- `src/lib/playbook` — the green-lead playbook; `assignNewLead` does round-robin when `enquiry_auto_reply.settings.assign === "round_robin"`; intake queues `playbook:ensure` as the safety net. `sla.responseMode === "call_first"` (Settings → "When a new lead comes in") promises the lead a call from the team instead of a booking link, names nobody, and does not set `firstResponseAt`: only a person does (portal "I've called them", a booking, an operator settling the item), and `src/lib/opportunities/call-first.ts` reminds the assigned person when the response window passes, then chases everyone with lead alerts (`sla_watch:chase_call`). `src/lib/digest/weekly.ts` — the Monday summary email (`weekly_digest`); `automationState()` reads a type with its registry default when a workspace has no row yet
- `src/components/shell/section.tsx` and `src/components/ui/*` — the building blocks every screen uses (PageHeader, Section, Panel, Empty, Stat/StatStrip tiles, Button, Badge, Table); `src/app/globals.css` holds the tokens and the few utilities that give the app its finish: `surface` (card with shadow), `surface-lift` (hover lift), `list-row` (edge-to-edge row tint), `rise`/`rise-stagger` (entrance motion), `page-wash`. Build new screens from these rather than hand-styling
- `src/components/shell/filter-chips.tsx` — URL-driven filter pills; a filtered list is a shareable, server-rendered URL
- `src/lib/intake` — intake schema and pipeline; `src/lib/qualify` — classifier
- `src/lib/ai` — the one way to call Claude: `claudeClient` (reused SDK clients), `routeFor` in `models.ts` (model, effort, tokens and deadline per kind of work; `QUALIFIER_MODEL`, `CONTENT_MODEL`, `TRIAGE_MODEL`, `AGENT_MODEL` override), `prices.ts` (list prices; cost in millionths of a dollar). Every Claude call calls `recordClaudeUsage` with the tenant, which writes one `AiUsage` row; platform admins see the month's spend per workspace on the portfolio. Tests swap in a scripted client with `_setClaudeClientForTests`
- `src/lib/agents` — Claude agents. `roles.ts` (each role's responsibilities, the only tools it may be offered, its autonomy ceiling); `tool.ts` (`defineTool`: a zod input, a risk class, a module, a preview; tools wrap existing services and take the tenant from the run, never from input; `ToolError` goes back to the agent); `tools/` (the tools themselves; results never carry phone numbers or emails, and public text comes back inside `<untrusted>`); `policy.ts` (`decideTool`: run, ask, propose or refuse from risk × autonomy × the tenant's override × module, a pure function; `AGENTS_MODE=off|shadow|live`). A tenant's use of a role is a `TenantAgent` row. Anything an agent sends goes through `sendMessage` with `sender: "AGENT"` and an `idempotencyKey`, so a retried step never sends twice. `runtime.ts` is the loop: `startAgentRun` (one run per `dedupeKey`), then `POST /api/jobs/agents` (called by the minute cron beside the tick) claims due runs on a lease and steps them; each step resolves the last turn's tool calls, then makes one `messages.create` call. The transcript (`AgentMessage`) is append-only and keeps every block as the API returned it, thinking signatures included: never edit an earlier turn, or caching and replayed thinking break. An `ask` parks the run (`WAITING`) with an exception linked by `agentToolCallId`; `decideAgentAction` approves (as asked, or with the tool's one `editable` field changed: `editedInput` runs, the transcript keeps what the model asked, and the agent is told what changed), declines with a note, or `takeOverAgentRun` stops the run; approvals expire after three days. Only a decision closes an approval: `resolveException` refuses them, so the queue's generic buttons and bulk close cannot. A run can be paused (`PAUSED`: never due; `resumeAgentRun` hands a run paused mid-step back to its worker) and given guidance (`AgentGuidance`, delivered once in the next turn the runtime writes, after any tool results). `views.ts` builds the queue's approval cards and the run timeline at `/console/[tenant]/agents/runs/[id]`. Customer Relations (`tools/customer.ts`, Sonnet 5.5, the role's `guide`) is started by `triggers.ts` on each missed opportunity about a lead and each reply from a contact with an open lead, after the automatic reply and the call-first chase, never instead of them; it writes call briefs (`LeadNote`, shown under "Needs you" and on the opportunity page) and may message only the lead its run is about. Customer-facing text is checked like content before anyone is asked (`signoff.ts`): hype and banned phrases go back to the agent, and a price, a claim or a flagged complaint, promise or legal point sets `AgentToolCall.signoff`, so only the client approves it, in their portal, routed by the `agent:signoff` escalation rule. `npm run eval:customer-relations` runs 20 scenarios against the real API on demo data (needs `ANTHROPIC_API_KEY`, about US$2; `-- --dry` checks the harness for free). Limits: 12 Claude calls a run, `runTokenCap`, `monthlyBudgetMicros` and `AGENTS_MONTHLY_BUDGET_USD` (default 150) per workspace. Tests drive runs with a scripted client (`src/test/agents-runtime.test.ts`)
- `src/lib/data` — repository contract with Prisma and in-memory implementations
- `src/lib/copy.ts` — the only place client-facing words for green/red live
- `src/lib/content` — the content engine: `compliance.ts` (brand + compliance block, enforced on every asset), `generate.ts` (Claude or the stub), `calendar.ts` (slots, gaps), `engine.ts` (material → drafts → approval → calendar), `actions.ts` (server actions)
- `src/lib/ads` (spend sync + pacing), `src/lib/attribution` (tracked links, the CPL/CPA/ROAS report), `src/lib/finance` (connectors, invoice reminders, webhooks), `src/lib/website` (beacon roll-up); `src/lib/money/actions.ts` — operator actions; `ADS_MODE=log` / `FINANCE_MODE=log` simulate
- `src/lib/onboarding` — the client onboarding questionnaire: `form.ts` (one definition per field: `CLIENT_STEPS` is the short public form at `/onboarding/[token]`, `CALL_SECTIONS` the operator's call sheet at `/console/onboarding/[id]/call`; the server validates against both; client-safe), `service.ts` (private links stored as hashes, save, submit, create the workspace), `questionnaire.ts` (answers from the form or the Claude Docs export → a draft definition and review list). `OnboardingSubmission` is platform-level: there is no tenant yet
- `src/lib/tenants/definition.ts` — `applyDefinition`: a whole workspace from data, shared by `scripts/provision.ts` and the console's Create workspace
- `src/lib/tenants/provision.ts` — the only way a workspace, member or API key is created; `src/lib/tenants/actions.ts` — the console's server actions; `src/lib/launch/readiness.ts` — the launch checks shown in settings; `src/lib/inventory` — CSV import, listing lookup for replies, drafts on new listings; `sync.ts` + `providers/` pull the rent roll from property management software (PropertyMe), `INVENTORY_MODE=log` simulates; `scripts/provision.ts` provisions a real workspace from a gitignored `tenants/*.json`
- `docs/runbooks/` and `docs/launch-checklist.md` — how it is run and what "ready" means
- `src/lib/social` — publishing (`publish.ts`), inbox + triage (`inbox.ts`), analytics (`metrics.ts`), hourly sync, encrypted channel credentials; `providers/` holds one adapter per platform behind `SocialProvider`; `SOCIAL_MODE=log` simulates everything
- `neon.ts` — Neon branch config (AI Gateway, `assets` bucket, `ops` Function with its minute trigger, Realtime); `neon/functions/ops.ts` is the Function
- `wrangler.jsonc`, `open-next.config.ts`, `cloudflare/worker.ts` — Cloudflare Workers build and the cron tick; `src/lib/prisma.ts` picks the Postgres driver per host (`DATABASE_DRIVER`)
- `src/lib/neon.ts` — which Neon services are configured; `src/lib/storage.ts` — tenant-prefixed object storage; `src/lib/realtime` — sealed live queries

## Conventions

- Server components by default; add `"use client"` only for interactivity.
- Client components that hold per-tenant state are keyed by `tenant.id`.
- Dates render in the tenant's timezone and money in the tenant's currency via
  `src/lib/utils.ts` helpers; never call `toLocale*` without a timezone.
- Commit messages: conventional prefix (`feat:`, `fix:`, `docs:`, `chore:`).
