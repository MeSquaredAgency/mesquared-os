# Launch plan: APN soft launch, January 2027

Written 27 October 2026 from the plan agreed with Elliot on 26 October,
updated for what has happened since. "You" is Elliot or anyone who owns an
account; "me" is engineering in this repository. Dates are working weeks from
27 October. The spec is `docs/product-spec.md`; the gaps it names are listed
at the end.

## What has changed since the first plan

- **Me² is not yet a registered business.** Anything that asks for a verified
  business cannot be applied for under Me²: WhatsApp Business, TikTok and
  LinkedIn developer apps, Google Ads API standard access, a Meta app of
  Me²'s own. Those move to after registration. An ABN held by a trust, with
  "MeSquared Agency" registered as a business name against it, would unblock
  them.
- **The Meta app exists under APN's business**, which is verified under APN's
  ACN. App ID `1142218158486204`. Webhooks are verified against the live
  endpoint and subscribed (Page: leadgen, feed, messages; Instagram: comments,
  messages). The two secrets are in the Cloudflare worker. Runbook:
  `docs/runbooks/meta-app.md`.
- **Deepgram is under Me²** (a personal account is enough), for voicemail
  and recording transcription.
- **The data deletion page** Meta requires is on
  [pull request 6](https://github.com/MeSquaredAgency/mesquared-os/pull/6),
  at `/legal/data-deletion` once merged.
- **The design-system pass** is on
  [pull request 5](https://github.com/MeSquaredAgency/mesquared-os/pull/5),
  green and waiting to merge.

## Week 1 (27–31 October): unblock the long waits

1. **Merge pull request 5 (design) and pull request 6 (data deletion page).**
   Deploy runs on merge. You.
2. **Finish the Meta app's Settings → Basic.** App domain
   `os.mesquaredagency.com`, privacy policy
   `https://mesquaredagency.com/privacy`, data deletion instructions
   `https://os.mesquaredagency.com/legal/data-deletion` (after step 1). You.
3. **Connect APN's Facebook page and Instagram account** in the console with
   a token from the app, signed in as an APN page admin. This is the first
   step of the testing script in the runbook. You with me.
4. **Run the testing script** in the runbook so every permission has been
   called from the app in development mode. Record each step; the recordings
   are the App Review screencasts. You with me.
5. **Submit App Review** with the paste-ready paragraphs in the runbook.
   Meta's review is the longest wait in this plan; commonly two to three
   weeks. You.
6. **Google Ads API basic access** under your own manager account at
   https://ads.google.com/aw/apicenter. Standard access waits for
   registration. You.
7. **Ask APN for the hand-overs** in one message: PropertyMe API token (their
   account manager issues it), Xero or whichever finance system they will
   connect, the Google Workspace calendar for Cal.com, owner access on the
   Google Business Profile, and which agents, the Director and the Region
   Managers get logins. You.
8. **Deepgram key** into the Cloudflare worker secrets as `DEEPGRAM_API_KEY`
   (Workers → mesquared-os → Settings → Variables and Secrets, type Secret).
   You.

## Weeks 2–4 (3–21 November): the code, in the order APN feels it

9. Google lead forms webhook into intake. Me.
10. Missed-call detector, with voicemail transcription attached to the lead. Me.
11. Ad copy, email and page drafts from the content engine, under the same
    compliance block. Me.
12. Time-based detector for unreplied DMs and comments. Me.
13. Payments advance the pipeline stage and show against the lead. Me.
14. A completed booking as a content trigger. Me.
15. Operator title and photo, and a real message thread between the client
    and their Me² person in the portal. Me.
16. A forwarding address provisioned per tenant, with the inbound-email
    webhook set up in Resend. Me, then you set the forward from APN's Google
    Workspace.
17. Images and video read as source material. Me.
18. A weekly client email from the Me² person: what came in, what was
    handled, what was won back, what needs them. Not in the spec; the most
    visible thing we can ship. Me.

## Weeks 5–6 (24 November – 5 December): connect APN for real

19. Cal.com on APN's Google Workspace at https://app.cal.com, event type set,
    webhook pointed at the platform. You with APN.
20. PropertyMe live sync with the token from step 7
    (`npm run tenant:connect-inventory`, see
    `docs/runbooks/onboarding-a-tenant.md`). Me.
21. Xero connected as a private app for APN's organisation at
    https://developer.xero.com/app/manage, or pipeline value only if trust
    accounting rules it out. You.
22. Meta page and Instagram switched from the test connection to live once
    App Review is approved and the app is published. Me.
23. Google Business Profile connected. Needs owner access on APN's listing. You.
24. Automations switched on one at a time in the console, with APN watching:
    enquiry auto-reply, booking lifecycle, review requests, chase
    information, inbox triage. Me.
25. Escalation rules: which APN person hears about what, in Settings →
    Escalation and values. You with APN.

## Weeks 7–8 (8–19 December): people on, soft test

26. Invite APN's agents, Director and Region Managers with their roles.
    Google sign-in works for apnre.com.au addresses. You.
27. One week of real use at APN with the exception queue watched daily. Fix
    what jars. You and me.
28. Launch readiness all green in Settings → Launch readiness, and the
    deployment checks at https://os.mesquaredagency.com/api/v1/health.

## After business registration

- Register the business name against the ABN, then: Meta Business
  verification for Me², a Meta app of Me²'s own (move the two secrets,
  reconnect APN's channels; nothing in the code changes), WhatsApp Business
  number and templates, TikTok and LinkedIn developer apps, Google Ads API
  standard access.
- Until then WhatsApp is out of January; the acknowledgement goes by SMS and
  email, which is the region default anyway.

## After launch, not January

- Google and Outlook calendar adapters, QuickBooks, REA and Domain listing
  feeds (Domain: https://developer.domain.com.au; REA through the agency
  agreement), site hosting and SEO, Me² billing its own clients.

## The two decisions that change the plan

- **TikTok for APN.** If no, nothing waits on a TikTok app at all.
- **WhatsApp.** Already deferred to after registration; confirm that SMS and
  email are acceptable for the January acknowledgement.

## Reference

- App: https://os.mesquaredagency.com
- Repository: https://github.com/MeSquaredAgency/mesquared-os
- Meta app: https://developers.facebook.com/apps/1142218158486204
- Hosting and secrets: https://dash.cloudflare.com (Workers → mesquared-os)
- Database: https://console.neon.tech
- Email sending: https://resend.com/domains
- SMS: https://console.twilio.com
- Sign-in: https://console.cloud.google.com, project mesquared-os
- Transcription: https://console.deepgram.com
- Runbooks: `docs/runbooks/`; launch checklist: `docs/launch-checklist.md`;
  Meta app: `docs/runbooks/meta-app.md`

## What the spec promises that is not built

Not built: Google, TikTok and LinkedIn lead forms; voicemail transcription;
booking over Google or Outlook calendars (Cal.com only); stages advancing on
payment; a missed-call detector and a timer-based DM and comment detector;
website pages, blog posts, ad copy and email from the engine; photos and
video as source material; a completed job as a content trigger; QuickBooks;
site hosting and SEO; REA and Domain as listing feeds; Me² billing.

Partly built: WhatsApp (sender and consent rules, no number); social DMs and
comments as intake (through triage, not the normalised intake event); the
forwarding inbox (endpoint and parsers, no per-tenant address); APN's
inspection and application flows (ride the generic lifecycle and chase
automations); the external accountant role (finance only, not read-only
elsewhere); the health score (fixed weights, not per-tenant).

Steps 9 to 17 above close the ones that matter for January.
