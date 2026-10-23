# MeSquared OS — Product specification

Source of truth for what the platform is and who it serves. Written from the
product owner's brief of 24 October 2026. Where a line says **[confirm]** the
answer is still owed by the anchor client; build to the stated default.

## 1. Purpose

MeSquared OS runs a client business's operations and marketing so the business
only has to act on what makes money. Me² operators do the running. Client
leaders see results, approve what needs their sign-off, and otherwise barely
log in.

Internally we call revenue work "green" and admin work "red". **Clients never
see those words.** Client-facing language is:

| Internal   | Client sees        |
|------------|--------------------|
| Green      | **Needs you**      |
| Red        | **Handled for you**|
| Recovered  | **Recovered**      |

Copy stays industry-neutral. The Phnom Penh team is not mentioned in
client-facing copy until Patrick decides otherwise.

## 2. Two surfaces, one platform

### Operator Console (Me² staff)

The core of the operator experience is a **portfolio view across all
tenants**. Operators are assigned to tenants and work across them. The console
shows, per tenant and in aggregate:

- health score
- SLA breaches
- missed opportunities and value at risk
- the exception queue (automation that needs a human)
- content due for approval or publication
- ad budget pacing
- integrations that are unconnected or failing

From the portfolio an operator drills into any tenant and sees everything the
client portal shows, plus configuration, automations, integrations and the
activity log.

### Client Portal (client leaders and staff)

Default home screen, top to bottom:

1. **Needs you** — new and hot leads.
2. **Missed opportunities** — each with the estimated value at risk, and the
   running total recovered.
3. **Money** — revenue this month against ad spend, and cost per lead.
4. **Content waiting for your approval.**
5. **Handled for you** — a quiet summary that opens into the full activity
   log.

Leads and missed opportunities are the daily driver for every business.
Inventory is not a core concept (see §7).

## 3. Permissions and roles

A fixed set of permissions underneath; role *names* are set by each tenant.

| Permission             | Meaning                                                  |
|------------------------|----------------------------------------------------------|
| `VIEW_FINANCES`        | sees revenue, spend, invoices, P&L                       |
| `APPROVE_CONTENT`      | can approve content in the chain                         |
| `RECEIVE_LEAD_ALERTS`  | gets lead notifications                                  |
| `MANAGE_USERS`         | invites and edits tenant users and roles                 |
| `VIEW_ALL_RECORDS`     | sees every record; without it, only their own            |

Default role templates seeded for every tenant:

| Template             | Permissions                                              |
|----------------------|----------------------------------------------------------|
| Owner                | all                                                      |
| Manager              | approve content, lead alerts, manage users, all records  |
| Staff                | lead alerts, own records only (no finances)              |
| External accountant  | view finances only, read-only                            |

APN names them Director, Region Manager and Property Manager; Property Managers
see their own leads only.

Me² operators are platform users with an **operator assignment** per tenant,
separate from tenant roles.

## 4. Intake

Intake is channel-agnostic: every item from every source becomes **one
normalised intake event**, then flows through qualification and the playbook.

Sources (each is a connector that a tenant switches on):

- website forms (native when the Website module is used)
- Meta lead forms and Google lead forms
- social DMs and comments
- a forwarding inbox per tenant
- call tracking and voicemail transcription
- marketplace and portal emails (e.g. REA and Domain)

APN uses: website forms, Meta lead forms, Google Ads landing pages, and
REA/Domain emails.

## 5. Leads, qualification and the playbook

Qualification criteria are set per tenant and read by Claude, with the rule
engine as the fallback. The result shows a one-line reason, with the full
breakdown on expand.

APN's criteria: green when the person is a property owner in Adelaide or Mount
Gambier, wants management, an appraisal or a sale, and gives a phone number.
Renting enquiries are handled automatically.

Default playbook for a green lead, configurable per tenant:

1. The lead lands at the top of the dashboard.
2. The lead receives an instant acknowledgement with a booking link, by SMS,
   email or WhatsApp depending on region.
3. The assigned person is alerted.
4. If nothing is booked within the SLA, the lead becomes a **missed
   opportunity** and goes to an operator.

Client staff handle conversations that need expertise or a licence; Me²
automation and operators handle everything else. Each tenant sets where that
line sits.

Booking runs through Cal.com over the tenant's own calendar (Google, Outlook or
others). APN: Google Workspace **[confirm]**.

## 6. Pipelines

CRM pipelines are set per tenant and seeded from industry templates. Stages
move automatically on bookings and payments.

APN, management: enquiry → appraisal booked → appraisal done → agreement sent →
signed.
APN, sales: appraisal → listing agreement → listed → sold.

Payments show against the lead, against the pipeline stage, and in the revenue
figures, wherever payment data exists.

## 7. Inventory (optional module, off by default)

Where a business has something to track — listings, appointment capacity,
stock — the module is switched on with a type set for that tenant. APN: on, for
listings and the rent roll, sourced from their property management software
and REA/Domain **[confirm which system]**.

## 8. Missed opportunities (core)

The system continuously detects revenue leaking out of the business and either
recovers it automatically or queues it for an operator. Detectors:

- unanswered enquiries
- missed calls
- abandoned forms
- leads that never booked
- no-shows
- quotes or proposals gone quiet
- unreplied DMs and comments
- unanswered reviews
- lapsed past customers

Each item carries an estimated value, so the client sees money at risk and how
much has been recovered. Values and SLAs are configured per tenant, seeded by
the industry template.

## 9. Admin automation

Reusable automation types that tenants switch on and configure:

- enquiry auto-reply with details and a booking link
- booking confirmation, reminder and follow-up
- chasing documents or information
- review requests
- invoice and overdue-payment reminders
- DM and comment triage
- reactivation of lapsed customers

APN adds: tenant availability replies, inspection confirmations and reminders,
and chasing incomplete applications. Maintenance stays out of January
**[confirm]**.

Exceptions — anything the automation is not confident about — go to Me²
operators through the console queue. Each tenant sets rules for what escalates
to a named client person instead.

Every automation run is logged; the log is what "Handled for you" summarises.

## 10. Content engine

- Accepts any raw material: voice notes, recordings, photos, video, reviews,
  case studies and documents.
- Runs on a scheduled batch per tenant **and** on events: a new review, a new
  listing or product, a completed job, or a gap in the content calendar.
- Each tenant switches on the channels it uses from Facebook, Instagram,
  TikTok, YouTube and LinkedIn (plus Google Business Profile). Each source
  item produces one asset per enabled channel. The same engine drafts website
  pages, blog posts, ad copy and email.
- Every tenant has a **brand profile** (voice, examples, banned phrases) and a
  **compliance block** enforced on every asset. Universal defaults: no hype,
  no invented statistics, no stale numbers.
- Approval chain per tenant. Default: a Me² marketing operator approves routine
  posts; the client signs off anything with prices, names or claims.
- Reviews are collected actively through a configurable automation and also
  used from uploads.

APN: Facebook, Instagram, Reels/TikTok and YouTube Shorts; LinkedIn low
priority **[confirm TikTok]**. Compliance: "Adelaide Property Network | RLA
255336" on every asset; never combine separate vendors.

## 11. Social

Publishing, scheduling, the content calendar, a unified inbox for comments and
DMs, and per-channel analytics for all five platforms plus Google Business
Profile.

## 12. Ads and marketing

- Connect Meta and Google Ads (TikTok and LinkedIn later) to pull spend and
  results.
- Tie spend to leads and revenue through tracking codes: cost per lead, cost
  per acquisition, return on ad spend.
- Alert on budget pacing.
- Produce campaign drafts from the content engine.

APN's $1k/month Meta and Google landlord campaign is the test case.

## 13. Finance

A connector layer, not a single provider: Square, Stripe and others for
payments; Xero and QuickBooks for accounting. Each tenant switches on what it
uses. The module shows revenue, outstanding invoices, overdue reminders, ad
spend against revenue, and a simple P&L.

APN's rent, bonds and commission run through trust accounting, so APN's finance
view may be pipeline value plus ad spend **[confirm Xero or similar]**.

Me² billing its own clients through the platform is a later module; the data
model leaves room for it (a platform-level customer and invoice).

## 14. Website module

Host or connect each tenant's site; forms post natively into intake; tracking
pixels and UTMs are wired to attribution; the content engine drafts pages and
blog posts; SEO and analytics roll into the dashboard.

APN: apnre.com.au forms and analytics.

## 15. Trust, tone and compliance

- The UI must feel safe for the business owner.
- Automated messages must feel safe for the client's customers: honest, never
  posing as a human, sent under the tenant's own identity.
- Messaging consent and privacy rules apply per region.

## 16. Anchor client and launch test

APN is a South Australian real estate agency doing property management and
sales. It seeds the **real estate** industry template and nothing more; the
product stays generic.

Success test for the January soft launch:

- For APN: every lead is captured and answered in under five minutes; missed
  opportunities are visible and recovered; a week of content is approved in
  one sitting; ad spend is tied to leads.
- For the product: APN was set up entirely through configuration, and a
  second, non-real-estate demo tenant (Courage Health & Fitness) runs on the
  same code.

APN's existing systems stay the record where one exists: property management
software **[confirm]**, Google Workspace, REA/Domain, Meta Ads and Google Ads.

## 17. Decisions on the first build

Keep: the tenant model, authentication (moving to permission-based roles),
the intake endpoint, demo mode, and most of the schema.

Discard: the equal-column green/red board, the manual compose box, stock as a
core concept, and the Square feed on the home screen. Square becomes one
finance connector among several.
