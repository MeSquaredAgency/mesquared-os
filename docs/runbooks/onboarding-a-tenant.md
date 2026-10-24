# Onboarding a tenant

A client is configuration applied to a template. Nothing about a client goes
into code: not their name, licence line, keys, phrasing or rules. If a client
needs something the template cannot express, extend the template or add a
setting; never add a branch for them.

## 1. Create the workspace

Console → **New workspace** (platform admins only).

- Template: real estate, health and fitness, or generic.
- Business name; the address is made from it unless you set one.
- Region and timezone preset: sets locale, currency and the messaging rules
  (consent requirements, quiet hours) for that country.
- Sender name and reply-to email: how messages are signed and where replies go.
- The compliance line every asset must carry. Required for real estate (the
  licence number); optional elsewhere.

You land on the workspace's **Settings**.

## 2. Fill in the business

Settings → **Business**: service levels (minutes to first response, hours to
book, quiet hours), service areas, what makes a lead worth a person's time,
what is handled automatically, brand voice, banned phrases, claims policy.
These feed the qualifier and the compliance block directly.

## 3. People

Settings → **People**: invite the owner first with a role that includes lead
alerts and user management. Hand over the one-time password privately; it is
shown once. Assign a Me² operator so exceptions reach a person.

Settings → **Escalation & values**: name the client person who should hear
about each kind of missed opportunity, and what each is worth in their
currency. The values drive the money figures the client sees.

## 4. Channels in

- Settings → **API keys**: issue an *intake* key for the website forms, call
  tracking and review feeds. Put it in the form as a hidden field or the
  `x-api-key` header. Issue a separate *content* key only if an integration
  uploads material; keep that one private.
- Connect the integrations the client uses (Meta lead forms, Cal.com, Twilio
  number, Google Business Profile, Facebook and Instagram pages, ad accounts,
  finance provider). Credentials are encrypted per integration row.
- Real estate: switch **Inventory** on (it is, by template) and import the
  listings or rent roll from CSV under Settings → **Inventory**. New active
  listings become content material and enquiries that name one get its link
  in the automatic reply.

## 5. Modules and automations

Settings → **Modules & automations**: turn off anything the client has not
asked for. Reactivation stays off for real estate by default.

## 6. Check readiness, then launch

Settings → **Launch readiness** lists the required, recommended and optional
items for the workspace and for the deployment. When every required item is
green, send one test enquiry through the real website form and watch it
arrive, get acknowledged and appear in the client portal. Then show the owner
their portal: Home, Leads, Missed opportunities, Content, Money, Activity.

## Taking a client off

Settings → Business → mark inactive (or `updateTenant({ isActive: false })`).
Revoke their API keys. Data stays for the retention period and is excluded
from every list and detector. Deletion is a manual, logged database operation
after the retention period.
