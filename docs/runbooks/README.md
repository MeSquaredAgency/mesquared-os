# Runbooks

Short, operational, and written for the person on duty. Each one answers:
what is this, how do I check it is healthy, what do I do when it is not.

| Runbook | When to open it |
|---------|-----------------|
| [deploy.md](deploy.md) | Shipping a build, running migrations, rolling back |
| [cloudflare.md](cloudflare.md) | Running the app on Cloudflare Workers: what the spike proved, secrets, Hyperdrive, the cron |
| [scheduler.md](scheduler.md) | The minute tick, SLA detection and scheduled sends |
| [incidents.md](incidents.md) | Something is wrong for a client right now |
| [onboarding-a-tenant.md](onboarding-a-tenant.md) | Setting up a new client workspace end to end |
| [onboarding-questionnaire.md](onboarding-questionnaire.md) | Sending a new client the onboarding form and creating their workspace from it |
| [secrets-and-backups.md](secrets-and-backups.md) | Keys, rotation, database branches and restores |

The launch gate itself is [../launch-checklist.md](../launch-checklist.md).
