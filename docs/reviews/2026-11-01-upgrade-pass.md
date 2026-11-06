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

- **"Call me back" reaches the caller.** The platform booking page (used
  until Cal.com is connected) took the request into the operator queue and
  told nobody at the business. Now the assigned person (or everyone with lead
  alerts) is texted and emailed with the words the lead chose, the page
  greets the lead by name, and the thank-you names who will ring them. With
  Cal.com connected the page forwards to the prefilled link instead of the
  bare event URL.

- **The reason reads as a sentence.** The rule engine's reason carried the
  score and each signal's weight, and the client saw it under "Why we handled
  this one". It is now plain words ("Reads as a routine question rather than
  a sale: left a phone number."); the weighted signals stay on the result for
  operators. The Claude classifier was already asked for plain sentences.

- **Staff can be the test lead from anywhere.** The destination rule still
  limits a workspace to its own country, but numbers listed in
  `MESSAGING_STAFF_NUMBERS` (a deployment secret, E.164, comma-separated) may
  be texted by any workspace. Twilio's geo-permissions must also allow the
  country. Nothing a public form submits can widen this.

- **A member's mobile works however it was typed.** Member phones were stored
  as entered ("0490 415 758"), and the destination rule only accepts E.164, so
  every lead-alert and callback text to a client's own people was skipped
  silently: no message row, no error, nothing in Twilio. Both alert paths now
  go through `textableNumber`, which normalises to E.164 using the workspace's
  region before checking the rule; provisioning and the People form store
  E.164 going forward; a text that Twilio rejects is now logged.

- **A lead always hears back if there is any way to reach them.** When the
  acknowledgement text fails at the provider and the lead left an email, the
  email goes instead, and the activity line says why ("the SMS couldn't be
  sent: …"). Before, a provider refusal ended the attempt and the lead got
  nothing. Only when every channel fails is the run marked failed and an
  exception raised.

- **Staff tests from abroad.** A workspace's local number often cannot text
  another country at all (an Australian mobile cannot reach Cambodia, Twilio
  error 21612). `MESSAGING_STAFF_FROM_NUMBER` names a platform number used as
  the sender whenever the destination is a staff mobile; the message still
  carries the workspace's name. Clients' own leads are never affected.

- **Call-first workspaces (2 Nov).** APN's view is that a new lead should
  always get a call, not a link. Before, the automated reply counted as the
  first response: the five-minute clock stopped the moment the robot texted,
  so nobody was chased if no human ever called, and the lead was told to
  "book a time". `sla.responseMode = "call_first"` (Settings → "When a new
  lead comes in") now tells the lead "one of our team will call you shortly"
  (no name, no link by text), leaves the lead in "Needs you" with the clock
  running, and when the window passes the SLA watch reminds the assigned
  person (or everyone with lead alerts) by text and email, then chases
  everyone again ten minutes later unless someone has marked the lead as
  called or they have booked. Book-first workspaces are unchanged.

- **The "Missed opportunities" module switch now does something (2 Nov).**
  APN's dashboard showed "$3,600 recovered this month": two of our own test
  enquiries, priced at the real-estate template's $1,800 default, marked
  handled. Before, the module toggle in Settings was decorative: the portal's
  nav link, home card and page, and the Monday email's money lines, all
  ignored it (only Inventory honoured its switch). `moduleOn(config.modules,
  key)` in the modules registry is now the one way to ask, and the portal nav,
  home card, opportunities page (404 when off) and the digest's recovered /
  at-risk lines all use it. Detection and the SLA watch keep running with the
  module off, because the call-first chase depends on them. Separately, a
  workspace whose values are all zero in "What a missed opportunity is worth"
  now gets counts without prices everywhere instead of "$0" figures.

- **The callback page under call-first (3 Nov).** `/book/[tenant]` predates
  call-first. A lead who typed "tomorrow after 3.30pm" was still unanswered
  as far as the five-minute clock knew, so the team would have been chased
  ten minutes later for a call the lead had scheduled; the text to the
  directors said "they chose this over booking online", which under call-first
  they were never offered; and a link with no lead on it thanked the person
  while telling nobody. `recordCallbackRequest` (`src/lib/scheduling/callback.ts`)
  is now the one path: it settles the clock, closes the open unanswered-enquiry
  item, logs it, opens the queue item that is the reminder to call, and tells
  the caller in words that fit the mode. A link without a lead asks for a name
  and number and goes through intake, so they are qualified, acknowledged and
  alerted like any enquiry.

- **A design pass so the OS feels finished, not clunky (4 Nov).** Patrick's
  note was "more sexy, less clunky". The structure stays (paper content,
  navy console sidebar, compact page headers); what changed is depth, rhythm
  and motion. Cards now sit on the paper with a soft layered shadow instead
  of a flat hairline, and the content area has a faint warm wash at the top.
  Numbers are separate tiles with an icon, not a hairline grid. The portal
  home is two columns on a wide screen: the work (needs you, approvals,
  handled) on the left, money at risk and this month's numbers beside it.
  Handled-for-you reads as a timeline. Avatars get a colour from the name,
  workspace rows show the business's mark, health bars are coloured by tone,
  state chips lead with a dot, active tabs and nav icons carry the coral
  mark. Buttons lift a hair on hover and settle on press; headers, sections
  and list rows rise into place on load (off under reduced motion). On a
  phone the lead actions drop under the lead instead of squeezing the text.
  Checked in the browser against demo data at desktop and phone width.

## Tasks with reminders, and an encrypted client chat (8 Nov)

Work between a client and Me² lived in email and texts, with no shared record of who owed what or when.

- **Tasks.** Every workspace has a task list in the client portal and the console. A task says who it is waiting on (the client or Me²), who has it, and when it is due, shown in the workspace's own timezone. Filters split "waiting on you" from "waiting on the other side".
- **Activity log.** Each task keeps a log of every change and comment, with who made it and which side they are on.
- **Reminders.** The scheduler emails a day before a deadline and again when it passes, once each per deadline. Overdue work Me² owes also lands in the operator queue. When the client owes it, Me² hears too, so someone can chase.
- **Chat.** One thread per workspace between the client's team and Me², with unread badges and live refresh. Each message is encrypted with AES-256-GCM before it is stored, bound to its workspace and message id, under a key derived from the existing integration secret, so it works from the first deploy. This is encryption at rest, not end-to-end: the server decrypts to show messages to the people allowed to read them.
- **Notifications.** The other side gets an email when someone writes, at most once per half-hour burst. The email names the writer and never includes the text.
- **Nav.** The portal gains Tasks and Messages with badges. The console workspace page gains Tasks and Messages buttons with counts.
- **Database.** One migration adds the Task, TaskEvent, ChatMessage and ChatRead tables. Nothing existing changes.

## Not done (candidates for a later pass)

- Chat attachments and @-mentions; tasks linked to a lead or a piece of content; a task digest in the Monday email.

- An outbox for event subscribers, so an acknowledgement survives a crash
  between the event and the send. Deliberately left: replaying handlers risks
  a second text to the customer unless every handler is made idempotent
  first; today a thrown handler becomes an exception and the detector catches
  a missed acknowledgement five minutes later.
