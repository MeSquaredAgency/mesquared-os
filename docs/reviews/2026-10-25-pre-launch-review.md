# Pre-launch review, 25 October 2026

Six independent reviews of the codebase as of commit `eb7ffbe`, one each for
security and tenant isolation, messaging and automations, the data layer,
runtime and deploy, the console and portal surfaces, and tests, docs and
launch readiness. Every finding below was confirmed by reading the code; the
production-impacting ones were also checked against the live database.

Items marked **fixed** were corrected the same day (commits `94f78be`,
`eb7ffbe` and the one after). Everything else is a decision or a job still
to do, ranked by what it would cost a client.

## Fixed today

1. **Daily and hourly jobs ran every minute.** Every tick re-requested the
   day's content batch, ads, finance, website and inventory syncs under the
   same key, and `scheduleAction` re-armed any finished row. The production
   database showed rows created 13 to 20 hours earlier re-running within the
   last minute. Finished keys now stay finished; only a cancelled reminder is
   re-armed. (`src/lib/data/prisma-repository.ts`, `memory.ts`, regression
   test in `hardening.test.ts`.)
2. **Lead alerts to staff were capped at four a day per person**, and the
   activity log said the person was told either way. Alerts to the tenant's
   own people are no longer counted against the customer cap, and when no
   recipient can be reached the run is logged as failed and an exception is
   raised. (`src/lib/messaging/index.ts`, `src/lib/playbook/index.ts`.)
3. **An operator could reset any account's password** by "inviting" its email
   into their workspace, including a platform admin's, and receive the
   one-time password. Invites now refuse Me² accounts and only reset a
   password for an existing member of that workspace.
   (`src/lib/tenants/provision.ts`.)
4. The classifier's written reason in lead-alert emails is passed through
   `quoteUntrusted`, so an injected URL cannot become a clickable link to
   staff.
5. A read straight after a write could be served stale on the worker:
   Hyperdrive query caching was on. Disabled, and `scheduleAction` no longer
   re-reads after insert. (Found while testing SMS; same session.)
6. Small: raw error text in one action, the scheduler runbook probing with
   the wrong header, the 404 page linking to a route that does not exist,
   and `CLAUDE.md` naming permission helpers that do not exist.

## Already handled, needs only tidying

- **The Cloudflare API token in git history** (commit `5c9a638`). The token
  was rolled in the Cloudflare dashboard on 25 October, so the value in
  history is dead; the GitHub deploy secret holds the new one. Left to do:
  delete or update the stale `.env.cloudflare.local` on the laptop, and
  optionally purge the blob from history with `git filter-repo` and a force
  push. Two reviewers flagged this independently.
- `docs/runbooks/cloudflare.md` still says the account is on Workers Free
  and the CPU limit is commented out. The account is Paid and the limit is
  active. `docs/runbooks/deploy.md` and `scheduler.md` still describe the
  pre-GitHub-Actions flow (Vercel, hand-run migrations, Neon Function as the
  caller). One docs pass.

## High: do before the first real lead

All nine were fixed on the `review-high-fixes` branch (commits `395fce2`
items 1, 3, 5, 8, 9; `de9158e` items 2, 6; `611e813` items 4, 7), each with a
regression test in `src/test/review-fixes.test.ts` and, for the SQL paths,
steps in `scripts/parity-check.ts`.

1. **Own-records-only users see everything in three places.** The leads list
   honours "view all records", but Missed opportunities, the Activity log
   and the social inbox are queried by tenant only, with lead names, messages
   and DM bodies in the summaries. A Team member at APN would read every
   colleague's leads. Thread `onlyAssigneeId` into `listMissedOpportunities`,
   `listAutomationRuns` and the portal home, and gate the inbox.
   (`src/app/app/[tenant]/opportunities/page.tsx:16`, `activity/page.tsx:16`,
   `content/page.tsx:23`.)
2. **A second enquiry from the same person within 24 hours is swallowed.**
   Dedupe is by phone or email only; the new message is not stored on the
   conversation and no reply or alert goes out. A renter asking about two
   properties in one afternoon hears back about one. Treat it as a duplicate
   only when the external id or message matches; otherwise create the lead
   on the same contact, or at least record the inbound message.
   (`src/lib/intake/process.ts:55`, `prisma-repository.ts:303`.)
3. **A refused destination blocks the email fallback.** An overseas number
   with an email gets nothing and raises an exception, because the allow-list
   refusal looks like a provider error to the send loop. Filter candidates
   with `destinationAllowed` before the loop so email goes first.
   (`src/lib/messaging/index.ts:110`, `handlers.ts:97`, `playbook:40`.)
4. **No real health check and no alert when the database or the tick is
   down.** `/api/v1/health` never touches Postgres; the cron only logs. Make
   health run `SELECT 1`, record the last tick time, and point an uptime
   monitor at it. (`src/app/api/v1/health/route.ts`, `cloudflare/worker.ts`.)
5. **Readiness can say "ready" when it is not.** The booking check cannot
   fail (`connected("CALCOM") || true`); the SMS check accepts the platform
   number, under which STOP replies are never recorded; webhook secrets are
   only "recommended" though the routes return 503 without them; the
   from-address, Meta verify token and Twilio webhook URL are never checked.
   (`src/lib/launch/readiness.ts:24-57`.)
6. **The public intake key also authorises fake missed calls and reviews.**
   The call and review endpoints accept the same key that sits in web forms.
   Give connectors their own scope. (`inbound/call/route.ts:37`,
   `inbound/review/route.ts:29`.)
7. **Rate limits and sign-in lockout are per-isolate** and do not hold on
   Workers; each colo starts fresh. Back them with a Postgres bucket or a
   Durable Object, and add a per-tenant daily intake cap so a scraped key
   cannot run up Claude costs. (`src/lib/intake/rate-limit.ts`,
   `src/lib/auth/rate-limit.ts`.)
8. **Console scheduling uses the operator's browser timezone**, not the
   tenant's, so a post typed as 09:00 from Phnom Penh goes out at 12:30
   Adelaide. Convert server-side with `zonedLocalToUtc`.
   (`src/components/console/content-studio.tsx:212,264`.)
9. **Abandoned-form detection can starve on Postgres**: sessions without an
   email or phone are fetched first and filtered out in code, so once 200 of
   them exist nothing is flagged again. Push the predicate into the query.
   (`prisma-repository.ts:632`.)

## Medium: before the second client

Done on the `review-medium-fixes` branch (26 October 2026) with tests in
`src/test/review-medium.test.ts`: everything in this list except the two
larger refactors noted inline, the PropertyMe adapter tests, and the finance
webhook ingestion test (its refusals are covered).

- "Assign to the property's manager" picks an arbitrary listing's manager
  when several match, and is gated on a signature preference. Assign only
  when one listing is named or all matches share a manager.
  (`handlers.ts:243`.)
- Suburb matching can offer wrong-suburb properties when two areas are
  mentioned, or when a street name contains a suburb. Match on the suburb
  attribute, and send the generic reply when more than one area appears.
- Listing mention never matches portal enquiries ("12 Smith Street" vs
  "12 Smith St, Suburb SA 5000"); normalise both sides. Done.
- SMS cost: the prefilled Cal.com link makes the acknowledgement three
  segments, and the "•"/"·" characters force UCS-2. Use the short tracked
  link and plain punctuation for SMS.
- A message held for quiet hours loses its button, reply-to and signature on
  release, and a re-held release is lost. (`handlers.ts:295`.)
- Daily jobs run at local midnight rather than after quiet hours, because
  the `quietHoursEnd(now − 24h)` branch never fires. (`tick.ts:39`.)
- `listLeadsPastSla` is unbounded and the console portfolio runs eight
  sequential queries per tenant. Count instead of fetch; bound the window.
- Money panel mixes currencies: ad spend is not filtered by currency.
- Nothing ever marks a lead WON or LOST, so win rate and customer detection
  via leads are always empty. Add `markLeadWon/Lost` on stage change.
- `applyTemplate` runs dozens of upserts outside a transaction.
- `parity-check.ts` has no production guard and writes real rows.
- Public booking callback form is unthrottled; dedupe per lead per day.
- "Operator" and "workspace" wording reaches clients in the login page,
  no-access page, workspace switcher and the forbidden error. The portal
  sidebar shows a "Data source: PostgreSQL" badge to clients.
- Destructive buttons (reset password, remove member, revoke key, take off
  calendar, close) fire on one click. The one-time password stays on screen
  until navigation.
- `SettingsStudio` and `MoneyStudio` receive more than the client needs
  (full `TenantSummary`, the operator roster, encrypted ad credentials).
  Still open: a DTO refactor of the settings studio.
- Deploy applies migrations before the worker is built, and CI never builds
  the worker, so a bundling failure is first seen after the schema moved.
  Reorder to build, migrate, upload; add `cf:build` to CI. Manual deploys
  from any branch are allowed; restrict `workflow_dispatch` to main.
- Provider `fetch` calls have no timeout and the tick has no deadline.
- Null ordering differs between Postgres and the memory store in four list
  queries (drafts without a date head the workbench on Neon).
- Route auth and signature checks have no tests, and two verifiers live in
  route files that cannot be imported by tests. API-key scope rejection is
  untested. PropertyMe adapter and finance webhook processing are untested.
- Several assertions pass against a broken implementation (`|| true`,
  `assert.ok(true)`, `typeof x === "number"`).
- `neon:check` writes a test lead into whatever tenant is first.
- The runbook tells operators to connect PropertyMe with a function nothing
  calls; add a script or settings action.

## Low

Missing indexes for a few query shapes; `createException` and
`upsertMembership` trust foreign ids their callers already validate;
pacing uses server-local dates; the memory store drops the newest row at
its cap; tracked-link codes are a global namespace; client-IP header trust
is not deployment-aware; cosmetic copy nits in templates; residual
wall-clock dependence in a few tests; worker fallback origin is the wrong
host.

## Verified sound

Sessions, password hashing and lockout design, post-login redirect, API key
hashing and scopes, integration credential encryption, every webhook
signature failing closed in production, tenant scoping of every repository
query and server action, storage key prefixing, logging hygiene, demo-mode
refusal in production, outbound templates' handling of untrusted text, HTML
escaping in email, claim-once scheduling, quiet-hours arithmetic including
DST, the Cal.com attendee check, the parity job on real Postgres, schema and
migrations in agreement, no ISR leakage between tenants, Workers runtime
compatibility, request body limits, repository hygiene (no client names,
secrets or debug output in the tree).
