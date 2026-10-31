# From onboarding questionnaire to workspace

Every new client answers the Me² onboarding questionnaire before their
workspace exists. The answers are written to set the workspace up directly,
so the questionnaire, the workspace definition and the console's Settings
pages describe the same things.

There are two ways in. Use the online form unless the client cannot.

## The online form (normal route)

1. Console → **Onboarding** (platform admins). Enter the client's business
   name and, optionally, their email, then **Create link**. The link is shown
   once, like an API key: **Copy link** or **Email it** (opens your mail app
   with a short message). It stays open for 60 days.
2. The client opens `/onboarding/<token>`. No account is needed: the token is
   the credential and is stored only as a SHA-256 hash. The form is ten short
   steps, works on a phone, and saves as they type, so they can stop and come
   back with the same link. Only seven answers are required: business name,
   type of business, time zone, their name and email, the confirmation tick
   and their full name.
3. When they press **Send to Me²**, the questionnaire shows as **Ready to
   review** in the console, with a count on the Onboarding menu item.
4. Open it. The page shows the **review list** (answers that could not be
   read, and the steps the form cannot do), **What will be set up**, the tasks
   they would hand over (for the Operational Blueprint), the drafted workspace
   file as JSON, and every answer by section.
5. Check the workspace address, then **Create workspace**. It applies the
   draft exactly as `npm run tenant:provision` would, invites the team with a
   password nobody sees, assigns you as operator, and opens the workspace's
   Settings. Reset each person's password from Settings → People to hand it
   over.
6. Finish the console steps in [onboarding-a-tenant.md](onboarding-a-tenant.md)
   (API keys, integrations), using the review list as the checklist, until
   Launch readiness is green. Use the intake call for anything the client
   skipped.

Other actions on a questionnaire: **Reopen for the client** (after they sent
it, so they can change answers with the same link), **New link** (the old link
stops working at once; use it when a link is lost or was forwarded), and
**Withdraw** (the link stops opening).

What is kept from the browser is defined in `src/lib/onboarding/form.ts`:
unknown fields are dropped, every string is bounded, a save is capped at
100 KB, and saves are rate limited per link and per IP. Answers are never
logged.

## The Claude Docs questionnaire (fallback)

For a client who would rather fill in a document, copy the **Me² Client
Onboarding Questionnaire** doc and share it.

1. When it comes back, export it: Claude Docs → **Export → Markdown**. Save it
   outside the repository or under `tenants/` (ignored by git); it holds the
   client's contact details.
2. Draft the definition:

   ```bash
   npm run tenant:from-questionnaire -- ~/Downloads/questionnaire.md
   ```

   This writes `tenants/<slug>.json` (refuses to overwrite one without
   `--force`) and prints the same review list, also saved at the top of the
   file as `_review`. Nothing is sent and no database is touched.
3. Work through `_review`, fix the file, then delete `_review`.
4. Provision, against whichever database `DATABASE_URL` points at:

   ```bash
   npm run tenant:provision -- tenants/<slug>.json
   ```

   It refuses a definition with problems before creating anything.
5. Finish the console steps as above.

Both routes reduce the answers to the same structure
(`QuestionnaireData` in `src/lib/onboarding/questionnaire.ts`) and draft the
workspace with the same code, so they set up identical workspaces.

## What each answer sets

The table names the doc's sections. The online form asks the same questions
in steps of the same names. In the doc, questions are matched by the start of
their wording (`QUESTIONS` in `src/lib/onboarding/questionnaire.ts`): if you
reword a question in the master copy, update the matching prefix and the test
fixture in `src/test/fixtures/onboarding-questionnaire.md`. In the form, a
field's `key` is what is matched, so its wording can change freely.

| Questionnaire (section: question) | Definition key | Where it lives in the OS |
|---|---|---|
| Header: Business name | `name`, `slug` | Workspace name and portal address |
| 1: Which best describes your business? | `templateKey` | Template: real estate, health and fitness, or generic |
| 1: Areas you serve | `serviceAreas` | Qualification rules |
| 1: Business addresses / phone / website and social links | `addresses`, `phone`, `website`, `social` | Settings → Business, email signature |
| 1: Main time zone, and currency | `region`, `timezone`, `locale`, `currency` | Region preset: consent rules, quiet hours, money and dates |
| 1: Main contact | `people` (as owner) | Only when the team table is empty |
| 4: What makes an enquiry worth your personal time? | `qualification.greenCriteria` | What the qualifier treats as "Needs you" |
| 4: Which services or requests are worth the most? | `qualification.highIntentServices` | Qualification rules |
| 4: Which enquiries could we answer for you? | `qualification.autoHandled` | "Handled for you" |
| 4: Must someone give a phone number? | `qualification.requirePhone` | Qualification rules |
| 4: How quickly should a new enquiry get its first reply? | `sla.firstResponseMinutes` | SLA watch: unanswered enquiries |
| 4: How soon should a good lead be booked? | `sla.bookingWindowHours` | SLA watch: leads that never booked |
| 4: Hours when customers should not get automated texts | `sla.quietHours` | Messaging policy |
| 4: What is a typical new customer worth? | `opportunityValues` | Money at risk and recovered |
| 4: Your Google review link | `reviewUrl` | Review request automation |
| 4: Past customers we could get back in touch with? ("No") | `switchOff.automations: ["reactivation"]` | Modules & automations |
| 4: Do you track listings, a rent roll, stock? ("No") | `switchOff.modules: ["inventory"]` | Modules & automations |
| 4: Where enquiries come from; how customers book; the steps to a paying customer; days before following up a quote | review list | Intake channels, Cal.com, pipeline stages, `quietAfterDays` |
| 5: Team table (one row per person, Yes/No per permission) | `people[]` with the template role whose permissions match | Settings → People |
| 5: Who should we tell when a good lead hasn't booked? | `escalation` (`NOT_BOOKED`, `QUIET_QUOTE`) | Settings → Escalation & values |
| 5: Signed by the business or the team member? | `signAsAssignee` | Settings → Business |
| 7: Systems table | review list | Integrations to connect |
| 7: Dedicated business number for texts? | `smsNumber` | The workspace's Twilio number |
| 8: Personality and how we should sound | `brand.voice` | Brand profile |
| 8: Example of an email or post | `brand.examples` | Brand profile |
| 8: Name customers see, and the reply-to address | `fromName`, `replyTo` | Branding |
| 8: Words or phrases we must never use | `brand.bannedPhrases` (added to the template's) | Compliance block |
| 8: Claims we may only make with proof | `brand.claimsPolicy` | Compliance block |
| 8: A line that must appear on every ad, post and email | `requiredFooter` | Compliance block, required for real estate |
| 9: Posts a week; best days and times | `content.postsPerWeek`, `content.slots` | Content calendar |
| 9: Channels ticked; ad budgets; who signs off posts | review list | Channel connections, ad account budgets, approvals |
| 11: How do customers agree to hear from you? | review list | Recorded consent before reactivation |

Sections 2, 3, 6, 10 and 12 (goals, today's back office, services, how we
work together, documents) feed the Operational Blueprint and the intake call,
not the workspace.

## How the importer reads answers

- Times: "under 5 minutes", "1 hour" (first reply); "2 days", "1 business
  day", "48" read as hours (booking window); "8pm to 8am" (quiet hours).
- Money: the first amount in the answer ("about $2,400 a year" is 2400).
  Enquiries, missed calls, no-shows, quiet quotes, lapsed customers and leads
  that never booked take that value; the smaller items (abandoned forms, DMs,
  comments, reviews) keep the template's proportion to it.
- Lists split on new lines and semicolons when the client used them, else on
  commas.
- Roles: the template role whose permissions equal the ticks, else the
  smallest role that covers them (noted on the review list).
- Anything unreadable stays at the template's value and goes on the review
  list. The importer never invents an answer.
