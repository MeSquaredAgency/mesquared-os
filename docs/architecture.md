# MeSquared OS — Architecture and build plan

Companion to `product-spec.md`. This is how the spec becomes code: surfaces,
domain model, module system, event flow, and the phased plan to the January
soft launch. Dated 24 October 2026.

## 1. Surfaces and routes

| Surface           | Route prefix      | Audience                | Entry                               |
|-------------------|-------------------|-------------------------|-------------------------------------|
| Operator Console  | `/console`        | Me² operators           | Portfolio view across assigned tenants |
| Client Portal     | `/app/[tenant]`   | Client leaders & staff  | "Needs you" home                    |
| Public            | `/book/[tenant]`, `/r/[code]` | Leads & customers | Booking pages, tracked links     |
| API               | `/api/v1/*`       | Integrations            | Intake, webhooks, connectors        |

One sign-in. After sign-in, operators land on `/console`; tenant users land on
`/app/<their tenant>`; a user with both goes to the console. Tenant switching
inside the console is the portfolio, not a dropdown.

Client-facing copy uses "Needs you", "Handled for you" and "Recovered". The
enum values stay GREEN/RED in code; the mapping lives in one place
(`src/lib/copy.ts`) so the words never leak.

## 2. Domain model

Everything below carries `tenantId` unless marked platform-level. Existing
models are kept unless listed under "replaced".

### Identity and access

- `User` (platform-level): email, password, `sessionVersion`, `isOperator`.
- `OperatorAssignment`: user ↔ tenant for Me² staff. Operators see only
  assigned tenants; platform admins see all.
- `TenantRole`: tenant-named role with `permissions: Permission[]`
  (`VIEW_FINANCES`, `APPROVE_CONTENT`, `RECEIVE_LEAD_ALERTS`, `MANAGE_USERS`,
  `VIEW_ALL_RECORDS`). Seeded from the four templates.
- `Membership`: user ↔ tenant ↔ `TenantRole`. **Replaces** the fixed
  `MembershipRole` enum.
- `TenantApiKey`: unchanged.

### Tenant configuration

- `Tenant`: adds `industry`, `region` (drives messaging consent rules and
  default channels), `sla` JSON (first-response minutes, booking window),
  `escalationRules` JSON (what goes to a named client person vs an operator).
  Keeps `locale`, `timezone`, `currency`, `branding`, `qualificationRules`.
- `IndustryTemplate` (code, not DB): `real_estate`, `health_fitness`,
  `generic`. Each template seeds roles, pipelines, qualification rules,
  missed-opportunity values and SLAs, automation defaults, brand defaults and
  the compliance block. Applying a template is configuration, never code.
- `TenantModule`: `moduleKey` (`inventory`, `social`, `ads`, `finance`,
  `website`, `content`, `calls`…), `enabled`, `settings` JSON. The module
  registry in code declares each module's settings schema and the
  integrations it can use.
- `Integration`: `provider` (CALCOM, GOOGLE_CALENDAR, META, GOOGLE_ADS,
  TIKTOK, YOUTUBE, LINKEDIN, GBP, SQUARE, STRIPE, XERO, QUICKBOOKS, TWILIO,
  RESEND, WHATSAPP, REA, DOMAIN, PM_SOFTWARE…), `status`
  (CONNECTED, NEEDS_ATTENTION, DISCONNECTED), encrypted credentials, `settings`
  JSON, `lastSyncAt`, `lastError`. **Replaces** `SquareIntegration` and
  `SocialConnection` as the one shape; social channels keep a thin `Channel`
  row pointing at the integration.

### Contacts, leads, pipelines

- `Contact`: a person or organisation; email/phone normalised; `consent` JSON
  per channel; `lapsedAt`. Leads, conversations and payments hang off it.
- `Lead`: an opportunity on a `Contact`. Adds `pipelineId`, `stageId`,
  `assigneeId`, `valueCents` (estimated), `firstResponseAt`, `bookedAt`,
  `source`, `attribution` link. Keeps classification fields.
- `Pipeline`, `PipelineStage` (ordered; `advanceOn`: BOOKING_CREATED,
  BOOKING_COMPLETED, PAYMENT_RECEIVED, DOCUMENT_SIGNED…). Seeded per tenant from
  the template.
- `Booking`: unchanged shape; provider CALCOM over the tenant's calendar.

### Intake and conversations

- `IntakeEvent`: becomes the normalised event: `channel` (WEB_FORM,
  META_LEAD_FORM, GOOGLE_LEAD_FORM, SOCIAL_DM, SOCIAL_COMMENT, EMAIL_FORWARD,
  CALL, VOICEMAIL, PORTAL_EMAIL), `provider`, `externalId`, redacted
  `payload`, parsed fields, `contactId`, `leadId`, `outcome`.
- `Conversation` + `Message`: one thread per contact per channel; inbound and
  outbound; `sentBy` AUTOMATION | OPERATOR | CLIENT_STAFF; delivery status.
  The unified social inbox and the forwarding inbox both read from here.

### Missed opportunities

- `MissedOpportunity`: `type` (UNANSWERED_ENQUIRY, MISSED_CALL,
  ABANDONED_FORM, NOT_BOOKED, NO_SHOW, QUIET_QUOTE, UNREPLIED_DM,
  UNREPLIED_COMMENT, UNANSWERED_REVIEW, LAPSED_CUSTOMER), `status` (DETECTED,
  RECOVERING, RECOVERED, ESCALATED, EXPIRED), `estimatedValueCents`,
  `recoveredValueCents`, `detectedAt`, `resolvedAt`, links to lead, contact,
  conversation, review. Detectors run on a schedule and on events; values and
  thresholds come from tenant config.

### Automation

- `AutomationType` (code registry): the reusable types from the spec, each with
  a settings schema, triggers, and the templates it sends.
- `TenantAutomation`: type, enabled, settings, escalation overrides.
- `AutomationRun`: every execution, with inputs, outcome (SENT, SKIPPED,
  ESCALATED, FAILED), and the human-readable line that "Handled for you"
  shows.
- `ExceptionItem`: the operator queue. `reason`, `confidence`, `suggestedAction`,
  `assignedOperatorId`, `escalatedToUserId`, `resolvedAt`.
- `MessageTemplate`: per tenant per automation per channel; rendered with the
  brand profile; always identifies as automated and as the tenant.

### Content and social

- `BrandProfile`: voice, examples, banned phrases, `complianceBlock`
  (required footer, prohibited combinations, claims policy), universal
  defaults applied on top.
- `SourceMaterial`: uploads (audio, video, image, document, review, case
  study); transcript; extracted hooks and quotes.
- `ContentAsset`: generated per enabled channel (and page, blog, ad copy,
  email); `sourceMaterialId`; `approvalState` with the chain position.
- `ApprovalChain` (tenant config): ordered steps with who (operator role,
  tenant permission) and conditions (price, named person, claim → client
  sign-off).
- `Channel`: a connected social destination incl. Google Business Profile.
- `SocialPost`: scheduled publication; `ContentCalendarSlot` for gaps.
- `InboxItem`: comments and DMs across channels, feeding conversations and
  the DM/comment triage automation.
- `ChannelMetric`: daily per-channel analytics.
- `Review`: collected reviews with reply status (feeds UNANSWERED_REVIEW).

### Ads and attribution

- `AdAccount` (META, GOOGLE, later TIKTOK, LINKEDIN), `AdCampaign`,
  `AdSpendDaily` (spend, impressions, clicks, platform-reported leads).
- `TrackingLink` / `TrackingTouch`: UTMs, pixels and short links that stamp
  a `Lead` with campaign attribution.
- Derived: cost per lead, cost per acquisition, return on ad spend, pacing
  alerts (spend vs budget vs days elapsed).

### Finance

- `Transaction` generalised: `provider` (SQUARE, STRIPE, XERO, QUICKBOOKS,
  MANUAL), `providerId`, kind, status, amount, currency, links to contact,
  lead, invoice.
- `Invoice`: provider, number, due date, status, reminders sent.
- Simple P&L from transactions + ad spend. Room for platform billing:
  `PlatformCustomer` and `PlatformInvoice` (platform-level, later).

### Website

- `Website`: domain, hosting mode (CONNECTED | HOSTED), form endpoints,
  pixel and UTM config, analytics source.
- Forms post to `/api/v1/intake` with a per-site key; tracking writes
  `TrackingTouch`.

### Inventory (optional)

- `InventoryItem` with `type` from tenant settings (LISTING, CAPACITY,
  STOCK) and `source` integration. **Replaces** `StockItem` as a core table.

## 3. Event flow

Everything is an event on an append-only `DomainEvent` stream per tenant
(`type`, `payload`, `occurredAt`, `causationId`). Automations, missed-
opportunity detectors, pipeline advancement, "Handled for you" and the
activity log all subscribe to it. Jobs run from a scheduler (cron routes under
`/api/jobs/*`, protected by a job secret) until a queue is warranted.

Lead playbook as events:
`intake.received` → `lead.qualified` → `message.sent(ack)` →
`alert.sent(assignee)` → (`booking.created` | `sla.breached` →
`missed_opportunity.detected` → `exception.queued`).

## 4. Integrations are modules

Each integration is a folder under `src/integrations/<provider>/` exporting:
`connect` (OAuth or key), `sync`, `webhook` handler, `health`, and the
capabilities it provides (intake, messaging, calendar, ads, finance, social).
The module registry maps tenant switches to capabilities; the console shows
unconnected or failing integrations straight from `Integration.status`.

## 5. Messaging

One `Messenger` interface with providers: Twilio (SMS, WhatsApp), Resend
(email). Region rules (`Tenant.region`) decide default channel, quiet hours
and consent requirements. Every outbound message is from the tenant's
identity, states it is automated, and is stored on the conversation.

## 6. Phased plan to January

Nine weeks from 27 October. Each phase ends with the demo tenants running on
the new code, tests passing, and a deployed preview.

**Phase 0 — Re-foundation (week 1). Shipped 24 Oct.** Permission-based roles and operator
assignments; tenant configuration, module registry and industry templates
(real estate, health & fitness, generic); contacts; pipelines; missed-
opportunity and automation models; domain events; the two surfaces with the
new home screens on demo data; client-facing copy. Remove the discarded UI.

**Phase 1 — Capture and respond (weeks 2–3). Code shipped 24 Oct; live once Twilio/Resend/Meta/Cal.com credentials are set.** Intake channels for APN: web
forms with tracking, Meta lead forms, forwarding inbox with REA/Domain
parsing. Qualification per tenant. Playbook: acknowledgement with booking link
(SMS/email), assignee alert, Cal.com over Google Calendar, SLA → missed
opportunity → exception queue. Automation runs and "Handled for you".

**Phase 2 — Recover and automate (weeks 4–5). Code shipped 24 Oct.** All missed-opportunity
detectors with per-tenant values; automation types: enquiry auto-reply,
booking confirmation/reminder/follow-up, document chasing, review requests,
reactivation; APN's availability replies, inspection reminders and
application chasing. Console exception queue and escalation rules.

**Phase 3 — Content and social (weeks 5–7). Code shipped 24 Oct.** Source material upload and
transcription; brand profile and compliance block; per-channel generation;
approval chain; calendar; publishing to Facebook, Instagram, YouTube
(TikTok on confirmation); Google Business Profile; unified inbox; review
collection; channel analytics.

**Phase 4 — Money and attribution (weeks 7–8). Code shipped 24 Oct.** Meta and Google Ads spend;
tracking links and attribution; CPL, CPA, ROAS and pacing alerts; finance
connectors (Square, Stripe, Xero) read-only; invoices and overdue reminders;
portal "Money" panel; website forms and analytics for apnre.com.au.

**Phase 5 — Launch (week 9). Code shipped 24 Oct.** Provisioning through the
console (a workspace is a template plus settings, never code): new-workspace
flow, settings studio (business, qualification, brand and compliance, service
levels, escalation rules, opportunity values, modules, automations), people
with one-time passwords, scoped API keys issued and revoked in the UI,
inventory module with CSV import feeding the content engine and the
listing-aware enquiry reply, launch readiness for the workspace and the
deployment, runbooks and the launch checklist against the success test;
messages signed by the assigned person; a PropertyMe listings sync. Real
tenants are provisioned as data on the production database once their
details are confirmed.

Ads campaign launching from the platform, website hosting, and Me² billing
its own clients are built after launch.

## 7. Open confirmations

| Item | Default we build to |
|------|---------------------|
| APN property management software | Treat as an email/CSV source until named |
| Maintenance requests out of January | Out |
| APN calendar | Google Workspace via Cal.com |
| TikTok for APN | Build the connector; enable on confirmation |
| APN accounting (Xero?) | Finance view = pipeline value + ad spend |
| SMS/WhatsApp provider for AU | Twilio SMS; WhatsApp when a number is approved |
| Google lead forms for APN | Google Ads landing pages via web forms + UTMs |
