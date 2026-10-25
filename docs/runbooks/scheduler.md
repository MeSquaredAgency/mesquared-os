# Scheduler: the minute tick

Everything time-based runs from one entry point, `POST /api/jobs/tick`
(`src/lib/jobs/tick.ts`). Every minute it:

1. runs the SLA detectors for every active tenant (unanswered enquiries,
   missed calls, quiet quotes, no-shows, unanswered reviews, lapsed customers);
2. claims and runs due `ScheduledAction` rows (reminders, follow-ups, quiet-hour
   releases, chasers) with a ten-minute lease and backoff on failure;
3. runs the daily and hourly jobs when they fall due (content batch, social
   sync, ads and finance sync, website roll-up, invoice reminders).

The caller is the Neon `ops` Function on a `* * * * *` trigger, authenticated
with `JOB_SECRET`. Anything that can POST with that header once a minute works
as a replacement (a host cron, GitHub Actions on a schedule, an uptime
monitor with a POST check).

## Is it healthy?

- Console → a workspace → **Settings → Launch readiness**: "JOB_SECRET set
  and the tick runs every minute" must be green on the deployment list.
- The activity log of any busy workspace shows automation runs within the last
  few minutes.
- `npm run neon:check` exercises the Function and reports the last trigger.
- Direct probe, from a machine with the secret:

```bash
curl -s -X POST "$NEXT_PUBLIC_APP_URL/api/jobs/tick" -H "Authorization: Bearer $JOB_SECRET"
```

It returns a small JSON summary of what ran. A `401` means the secret is wrong
on one side.

## When it stops

Symptoms: no new "Handled for you" entries, missed opportunities not being
raised, reminders not going out, drafts not appearing on the content day.

1. Probe the endpoint as above. If it works, the trigger is the problem:
   redeploy the Neon branch (`neon deploy`) and check the Function logs.
2. If it returns `401`, `JOB_SECRET` differs between the app and the Function
   environment. Set them equal and redeploy both.
3. If it returns `500`, read the app logs. The tick isolates tenants, so one
   failing tenant is logged and the others still run; a 500 means something
   shared (database connectivity most often).
4. After a gap, the next tick catches up: detectors are idempotent (one
   missed-opportunity row per subject), scheduled actions run when due or
   later, and daily jobs run once per day whenever the first tick arrives.
   Nothing needs replaying by hand.

## Changing how often it runs

Do not. Detectors are tuned to a one-minute cadence and SLA deadlines are
measured in minutes. Running less often makes "answered in under five minutes"
impossible to honour.
