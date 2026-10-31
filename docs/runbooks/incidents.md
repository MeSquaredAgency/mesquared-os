# Incidents

An incident is anything that stops a client being answered, charged correctly,
or shown the truth. Severity is about client impact, not code.

| Severity | Examples | Response |
|----------|----------|----------|
| 1 | Leads arriving but no acknowledgement going out; wrong tenant's data visible; messages sent to the wrong people | Stop the bleeding within 15 minutes, then fix |
| 2 | Tick stopped; a connector failing for one client; content not drafting | Same business day |
| 3 | A number looks off; a page errors for one role | Next working day |

## First five minutes

1. Confirm the blast radius: one tenant or all? One channel or all?
   `GET /api/v1/health` and the console portfolio answer the "all" question.
2. If messages are going out wrongly, set `MESSAGING_MODE=log` on the app and
   redeploy. Everything else keeps running and every intended send is written
   to the activity log for later review. Tell the operators.
3. If data is being shown across tenants, take the app offline at the host.
   This has never been acceptable to leave running for a moment.
4. Note the time and what you did, in the incident channel.

## Common causes, fastest checks

- **No acknowledgements**: tick running? (see [scheduler.md](scheduler.md)).
  Twilio or Resend credentials present? The automation run says honestly
  `SKIPPED` with the reason when a sender is not configured.
- **A client's leads missing**: is their intake key still active (console →
  settings → API keys)? Did the form host change domain? The intake endpoint
  returns `403` for revoked or wrong-scope keys (`401` only when no key is
  sent) and is rate limited per workspace and per IP.
- **Duplicate messages**: scheduled actions are claim-once with a lease; a
  duplicate almost always means two schedulers are running (an old host cron
  plus the Neon trigger). Turn one off.
- **Content not drafting**: the content engine automation is on, at least one
  channel is connected, and the material passed compliance. Each skip is
  recorded as an automation run with the reason.
- **Finance totals wrong**: webhooks are per workspace integration id; check
  the provider dashboard shows deliveries succeeding. Re-sync is idempotent on
  provider ids.
- **"This page didn't load"**: take the reference from the error page and
  search the Worker log for it, or for `[request-error]` (see "Reading the
  logs" in [cloudflare.md](cloudflare.md)); the log line has the route and
  the real message. A burst of `[db] retrying` lines alongside means the
  database connection, not the page, is the problem.

## Talking to the client

Clients see "Needs you", "Handled for you" and "Recovered". Never say
"green", "red", "operator", "workspace" or "tick" to them. Say what happened
to their enquiries and what is being done.

## Afterwards

Write five lines: what broke, when it was noticed, what the client saw, what
fixed it, what stops it recurring. File it next to this runbook under
`docs/incidents/YYYY-MM-DD-short-name.md`. Add a test when the cause was code.
