# Onboarding a tenant

A client is configuration applied to a template. Nothing about a client goes
into code: not their name, licence line, keys, phrasing or rules. If a client
needs something the template cannot express, extend the template or add a
setting; never add a branch for them.

## 0. Or do it from a file

For a real client, write a definition under `tenants/` (ignored by git; see
the comment at the top of `scripts/provision.ts` for the shape) and run:

```bash
npm run tenant:provision -- tenants/<slug>.json
```

It creates or refreshes the workspace, applies the template, invites the
people with their roles, assigns operators, confirms platform admins, attaches
the workspace's SMS number (`"smsNumber": "+614..."`: texts go out from it and
replies to it come back to this workspace; the Twilio account itself lives in
the deployment's secrets), the email signature details (`logoUrl`, `website`,
`phone`, `addresses`, `social`, and per person `title`, `mobile`, `photo`, all
editable later under Settings → Business and Settings → People → Signature)
and prints the readiness score. Listings or a rent roll go in with
`npm run inventory:import -- <slug> file.csv [source]` (same columns as the
Settings → Inventory upload; a `manager` column lets rental enquiries be
answered by the property's own manager). Passwords are never printed: reset each person's
from Settings → People and hand the one-time password over privately. Steps
1 to 3 below are what the file does for you; 4 to 6 still happen in the
console.

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

- Settings → **API keys**: issue an *intake* key for the website forms and the
  page beacon. Put it in the form as a hidden `_key` field or the `x-api-key`
  header; it is public by nature. Call-tracking and review connectors get
  their own *webhooks* key (they can raise missed calls and text people back,
  so that key stays private), and an integration that uploads material gets a
  *content* key.
- Connect the integrations the client uses (Meta lead forms, Cal.com, Twilio
  number, Google Business Profile, Facebook and Instagram pages, ad accounts,
  finance provider). Credentials are encrypted per integration row. The
  Facebook page and its Instagram account connect in one step with
  `npm run tenant:connect-meta -- <slug>` from a Graph API Explorer token;
  see `docs/runbooks/meta-app.md`.
- Real estate: switch **Inventory** on (it is, by template) and either import
  the listings or rent roll from CSV under Settings → **Inventory**, or connect
  the property management software (PropertyMe: an OAuth token with the
  `property:read` and `offline_access` scopes). Store it with
  `PROPERTYME_TOKEN=... npm run tenant:connect-inventory -- <slug> propertyme PROPERTYME_TOKEN`
  (the token is read from the environment, never typed on the command line);
  it is encrypted on the integration row. The daily sync
  then keeps the rent roll current. New active listings become content
  material and enquiries that name one get its link in the automatic reply.
- If the client wants messages signed by the agent looking after each lead,
  tick "Sign messages as the person assigned to the lead" under Settings →
  Business. The lead must be assigned for it to apply; unassigned leads are
  signed by the business.

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

## Signing in with Google

With `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` set on the
deployment, the sign-in page shows **Continue with Google**. It signs in an
existing account whose email matches the verified Google email; it never
creates an account, so inviting someone under Settings → People is still the
only way in. Passwords keep working alongside it. The OAuth client lives in
the Me² Google Cloud project (the same one the Google Ads and Business
Profile connectors use); its authorised redirect URI must be
`<public URL>/api/auth/google/callback`, and the consent screen must be
published (External, in production) so people outside the Me² Google
Workspace, such as a client's staff, can use it.
