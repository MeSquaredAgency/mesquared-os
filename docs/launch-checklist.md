# Launch checklist

The spec's success test (product-spec §16), as things a person can tick. The
console shows most of these live under a workspace's **Settings → Launch
readiness**; this page is the human version and the order to do them in.

## Platform (once)

- [ ] Postgres connected; `GET /api/v1/health` reports `postgres`.
- [ ] `AUTH_SECRET`, `INTEGRATION_ENCRYPTION_KEY`, `JOB_SECRET` set and long.
- [ ] `NEXT_PUBLIC_APP_URL` is the public https URL; booking links and
      webhooks resolve to it.
- [ ] The minute tick is running against the public URL (runbook:
      [scheduler](runbooks/scheduler.md)).
- [ ] `MESSAGING_MODE`, `SOCIAL_MODE`, `ADS_MODE`, `FINANCE_MODE` are **not**
      `log`.
- [ ] Twilio and Resend credentials present; a test SMS and email arrive.
- [ ] `ANTHROPIC_API_KEY` set; the qualifier and the content engine report
      Claude, not the stub.
- [ ] Webhook secrets set: Meta, Cal.com, inbound email, Twilio.
- [ ] CI green on `main`; parity check passes against the production schema.
- [ ] Demo tenants (Harbor Realty, Summit) exist on production only as
      rehearsal workspaces for operators; no real user is a member of them.
- [ ] Runbooks read by whoever is on duty in the first week.

## For the anchor client

- [ ] Workspace created from the **real estate** template through the console,
      with nothing client-specific in code (grep the repository for the
      client's name: nothing).
- [ ] Licence line set as the compliance footer and appearing on every draft.
- [ ] Owner invited with lead alerts and user management; password handed over
      privately and changed.
- [ ] Operator assigned.
- [ ] Escalation rules name a client person for every type they care about;
      opportunity values set in AUD.
- [ ] Intake key issued and in the website form; one real enquiry arrives,
      is acknowledged in under five minutes, and appears under **Needs you**
      or **Handled for you**.
- [ ] Meta lead forms, the forwarding inbox and call tracking connected; one
      lead from each lands.
- [ ] Cal.com connected; the booking link in an acknowledgement prefills.
- [ ] Twilio number on the tenant; quiet hours correct for Adelaide.
- [ ] Listings or rent roll imported; an enquiry naming an address gets that
      listing's details in the automatic reply.
- [ ] Facebook, Instagram and Google Business Profile connected; the content
      engine drafts a week of posts; the owner approves them in one sitting.
- [ ] Meta Ads and Google Ads accounts connected with monthly budgets; the
      attribution report shows spend against leads.
- [ ] Finance provider connected (or left at pipeline value, knowingly).
- [ ] Website beacon on the site; the daily roll-up shows visits and forms.
- [ ] Owner has seen their portal and knows what "Needs you", "Handled for
      you" and "Recovered" mean.

## For the product

- [ ] A second, non-real-estate client runs on the same code from the health
      and fitness template, set up the same way, with its own people, keys,
      channels and values.
- [ ] Both workspaces pass every required readiness check.
- [ ] Nobody has typed a client's name into source. `git grep -i` for both
      client names returns only documentation.

## Day one and week one

- Day one: watch the activity log of each workspace; every enquiry has a
  run beside it within minutes. Check the queue twice.
- Day three: review the first missed opportunities raised and whether the
  values look right; adjust in Settings → Escalation & values.
- Day seven: the first week of content approved; the pacing exception has
  fired or not for a reason; the attribution report makes sense to the owner.
- Write down what the owners asked that the product could not answer. That is
  the next phase.
