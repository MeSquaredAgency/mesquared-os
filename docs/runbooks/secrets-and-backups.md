# Secrets and backups

## Where secrets live

| Secret | Where | Rotation |
|--------|-------|----------|
| `AUTH_SECRET` | App environment | Rotating signs everyone out. Do it on a quiet evening. |
| `INTEGRATION_ENCRYPTION_KEY` | App environment | Encrypts integration credentials (AES-GCM, keyed per row). Rotation requires re-encrypting every `Integration.credentials` row; there is no script yet, so treat this key as long-lived and guard it. |
| `JOB_SECRET` | App and Neon Function environments | Change both, redeploy both. The tick fails with 401 until they match. |
| `ANTHROPIC_API_KEY` | App environment | Rotate freely; the stub takes over if it is missing. |
| Twilio, Resend, Meta, Google, LinkedIn, TikTok, Xero, Square, Stripe | App environment for app-level keys; per-tenant tokens in `Integration.credentials`, encrypted | Per provider; reconnect in the console to refresh a tenant token. |
| Tenant API keys | Stored as SHA-256 hashes only | Revoke and issue a new one in Settings → API keys. The raw key is never recoverable. |
| Passwords | scrypt hashes | Reset from Settings → People; a one-time password is shown once. |
| Neon credentials | `.env.neon.local` (gitignored) | Rotate in the Neon console; never commit or print. |

Rules: no secret is ever logged, put in a URL, or shown in the UI after the
moment it is issued. Lead payloads are stored through `redactPayload`.

## Backups and restores

Neon keeps point-in-time history for the production branch. To restore:

1. In the Neon console, create a branch from the production branch at the
   timestamp before the damage. Nothing in production changes yet.
2. Point a local checkout at the new branch (`DATABASE_URL` of that branch) and
   verify the rows you need are there.
3. For a single bad row or a bad import, copy the rows back with SQL against
   production. For a broken release, follow the rollback steps in
   [deploy.md](deploy.md) and swap the app to the restored branch.
4. Delete the scratch branch when done.

Object storage (uploaded material in the `assets` bucket) is tenant-prefixed
and versioned by key; a deleted object is a new upload, not a restore.

## Access

Platform admins see every workspace; operators see the ones assigned to them;
client users see their own workspace through the portal with the permissions
on their role. Review the platform admin list monthly. Remove a person from a
workspace in Settings → People; remove an operator by unassigning them.

## What to check quarterly

- Rotate `AUTH_SECRET` and `JOB_SECRET`.
- Confirm a point-in-time restore works, on a scratch branch.
- Revoke API keys that have not been used in 90 days (last use is shown).
- Re-read the deployment half of Launch readiness on a real workspace.
