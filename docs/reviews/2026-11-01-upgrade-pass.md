# Upgrade pass — 1 November 2026

An engine-and-cosmetics pass over the whole product ahead of the January soft
launch. Ranked by what it is worth to a client or an operator. Everything here
is covered by `src/test/upgrades.test.ts` unless marked otherwise.

## Deploy notes

- **Run the migration.** `20261101090000_hot_query_indexes` adds indexes for
  the queries behind every webhook, send and tick. `npm run db:migrate` (or
  `prisma migrate deploy`) before the first tick on the new code.
- **No new environment variables are required.** Optional:
  `QUALIFIER_TIMEOUT_MS` (default 8000) and `TICK_CONCURRENCY` (default 4).
- The health endpoint now returns 503 when the oldest due scheduled step is
  more than ten minutes old. If an uptime check starts failing after deploy,
  the queue is behind, not the deploy.

## What changed and why

### Leads that were being lost

- **Webhook API keys worked in demo mode only.** The Prisma store dropped the
  `webhooks` scope when reading keys, so call-tracking and review connectors
  were refused with 403 in production. One shared guard (`isApiKeyScope`) now
  decides what a scope is, everywhere.
- **Meta lead forms survive a Graph API failure.** A failed fetch used to be
  logged and forgotten. It is now queued as a `meta_lead:fetch` action and
  retried through the normal three-attempt, dead-letter path; a missing page
  token raises an exception.
- **Double-submitted forms are one lead.** A submission without an upstream
  id gets a derived one (person, words, day), so the unique index catches two
  copies arriving in parallel.
- **The Anthropic qualifier has an 8-second deadline** and falls back to the
  rule engine rather than holding intake past the five-minute SLA. A tenant's
  `requirePhone` rule is enforced on the model path too.

### Trust and compliance

- **Escalation emails only go to current members** of the workspace. A rule
  pointing at a removed person, an operator, or an id from another tenant is
  ignored and logged. A rule for the exact type beats the catch-all.
- **Opt-outs are final.** A contact who replied STOP is never texted again by
  an automation, in any region, transactional or not. STOP/START only match a
  whole-message keyword ("Cancel my appointment" is not an unsubscribe; "Yes,
  Tuesday works" is not consent).

### Money at risk tells the truth

- **Settled items stay settled.** Recovering or closing an unanswered enquiry
  or a never-booked item stops the lead's clock, so the detector does not
  raise the same lead again a week later.
- **One item per lead.** A lead nobody replied to is no longer also counted as
  never-booked.
- **Recovered value follows the person back.** A new reconciler closes open
  items as RECOVERED when the person enquires again, replies, books or pays
  (at the paid amount). Previously only four of ten detector types ever
  recovered.
- **The portal headline sums every open item**, not the twenty shown.
- **Pacing uses the tenant's calendar month** and compares budget and spend in
  the same currency. Pacing alerts are raised once per month and direction.

### Operators

- **Health explains itself.** The score carries its breakdown ("2 SLA
  breaches, 1 failing integration") in the portfolio row and on hover.
- **Every list filters.** Queue by workspace and kind; missed opportunities by
  kind; activity by outcome, grouped by day; leads by search and view. Filters
  live in the URL, so a view can be shared.
- **The portfolio is cards on a phone.**
- **The tick is bounded.** Detectors run four tenants at a time with their own
  share of the minute; retries back off (5, 10, 20 minutes with jitter); a step
  that can never succeed fails at once; a subscriber that throws becomes an
  exception once an hour instead of a log line.
- **The health endpoint reports the queue backlog.**

### Clients

- **"I've called them"** on Needs you: stops the lead's clock, moves it to
  nurturing, recovers its open items and logs who did it.

### Pipelines

- **Stages move on attended appointments and payments**, as the spec says. A
  stage marked won settles the lead; a win or a payment queues a review ask,
  throttled to one per person per quarter by a count rather than a scan.

## Second batch (same day, after the first merged)

- **Payments show against the lead.** A synced or manual transaction is
  linked to the contact's most recent live lead (never a lost one), so the
  attribution report's revenue per channel follows the lead that earned it.
- **The expiry sweep.** A daily `sla_watch:expire` step writes off open items
  older than `expireAfterDays` (default 30, 0 turns it off), closes their
  exceptions, and leaves one honest line in the activity log. Money at risk
  stops accumulating what nobody can recover.
- **The queue shows the money.** Each item carries the kind and value of the
  missed opportunity behind it, the header totals what is riding on the
  filtered view, and "Most at stake first" is one click.
- **One-line JSON logs** (`src/lib/log.ts`) on the scheduler and event paths,
  with tenant, action and event ids as fields, so Cloudflare log queries can
  filter per workspace.

## Third batch (same branch)

- **Round-robin lead assignment.** With "Share out in turn" on (Settings →
  Modules & automations → Lead assignment), a new green lead goes to the
  alert holder with the fewest new leads this week, only that person is
  alerted, and the acknowledgement is signed as them when that is on. Off by
  default: everyone with lead alerts is told, as before.
- **The Monday email.** Owners and managers get one plain email on Monday
  morning: enquiries, what was handled, what was recovered and for how much,
  what is still at risk, the month's money (only for people who may see it)
  and whether anyone is waiting. On by default (`weekly_digest`); a missed
  Monday sends on Tuesday.
- **A safety net under the playbook.** Intake queues a `playbook:ensure`
  step three minutes out. If the request died before the playbook logged
  anything, the tick runs it then; a lead that already had its turn is left
  alone, so there is never a second acknowledgement. This is the durable floor
  the outbox would have given, without the duplicate-send risk.
- Settings lists every automation type the registry knows, with its default
  state, so a type added after a workspace was set up can still be switched.
- **A lead who texts back is heard.** Before, an SMS or WhatsApp reply only
  landed in the conversation; nobody was told and nothing watched it. Now the
  assigned person (or everyone with lead alerts) gets the words by email at
  once, nothing automated answers, and the inbox watch raises it as an
  unreplied message if nobody replies within the usual window.

## Fourth batch: the client's eyes, and the agent's phone

- **The phone buzzes.** A new green lead now also texts the assigned person
  (or everyone with lead alerts) in one GSM segment: who, what, where, the
  number, and whether we have already replied. The email with the full detail
  still follows. "Every lead answered in under five minutes" starts with the
  agent knowing within seconds; email alone did not do that. Off per
  workspace with `enquiry_auto_reply.settings.alertBySms = false`; a member
  with no phone on their profile gets email only.
- **No machine detail on the client's screens.** The lead list no longer shows
  an intent score or whether "AI" or "Rules" classified the lead; the reason
  is behind "Why this one needs you" / "Why we handled this one". "Handled for
  you" and the activity log show the sentence and the time, not our automation
  type names. Empty states no longer mention intake or automations.

## Not done (candidates for a later pass)

- An outbox for event subscribers, so an acknowledgement survives a crash
  between the event and the send. Deliberately left: replaying handlers risks
  a second text to the customer unless every handler is made idempotent
  first; today a thrown handler becomes an exception and the detector catches
  a missed acknowledgement five minutes later.
- Visual verification of the UI changes in both batches: the dev server could
  not bind a port in the sandbox this session, so they are verified by
  typecheck, lint, tests and a production build only.
