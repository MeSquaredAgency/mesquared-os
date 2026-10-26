# Meta app: setup, testing and App Review

The platform talks to Facebook and Instagram through one Meta developer app.
Every tenant's page, Instagram account and ad account connects through it.

- App ID: `1142218158486204` (dashboard: https://developers.facebook.com/apps/1142218158486204)
- Owner: APN's Business Manager, business-verified under APN's ACN, until Me² is
  registered and verified. Then create an app under Me², move the two secrets,
  and reconnect each tenant's channels. Nothing in the code changes.
- Secrets on the Cloudflare worker: `META_APP_SECRET` (Settings → Basic → App
  secret) and `META_WEBHOOK_VERIFY_TOKEN` (any long random string; the same
  value goes in the Webhooks verify-token field). Both are Secrets, not plain
  variables; plain variables are wiped on deploy.
- Webhook callback: `https://os.mesquaredagency.com/api/v1/webhooks/meta`.
  Page object: `leadgen`, `feed`, `messages`. Instagram object: `comments`,
  `messages`. The GET handshake can be checked with
  `curl "https://os.mesquaredagency.com/api/v1/webhooks/meta?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=12345"`,
  which must print `12345`.
- Settings → Basic: app domain `os.mesquaredagency.com`, privacy policy
  `https://mesquaredagency.com/privacy`, data deletion instructions
  `https://os.mesquaredagency.com/legal/data-deletion`.

## Use cases and permissions

Keep five use cases. Everything else (WhatsApp, Threads, Catalog, app ads,
embeds, create and manage ads) is removed so the review stays small.

| Use case | Permissions | What the platform does with them |
|---|---|---|
| Capture & manage ad leads | `leads_retrieval`, `pages_manage_ads`, `pages_show_list`, `ads_read` | Lead-form submissions arrive by webhook; the answers are fetched and become a lead in the business's workspace |
| Measure ad performance data | `ads_read`, `read_insights` | Daily spend and results for budget pacing and cost per lead |
| Engage with customers on Messenger | `pages_messaging`, `pages_manage_metadata` | Messages to the page land in the inbox; a person replies as the business |
| Manage messaging & content on Instagram | `instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_insights`, `instagram_manage_messages` | Publish approved posts, read and reply to comments and messages, read account numbers |
| Manage everything on your Page | `pages_manage_posts`, `pages_read_engagement`, `pages_read_user_content`, `pages_manage_engagement`, `pages_manage_metadata`, `pages_show_list`, `read_insights` | Publish approved posts, read comments and reviews, reply, read page numbers |

## Testing requirements

Meta wants each permission exercised from the app while it is in development
mode. Use APN's own page with the reviewer account added as a tester, or a
test page. In the console (`/console/<slug>`, Content and social):

1. Channels → Connect a channel: Facebook page with a page token generated
   from the app. Then Instagram with the business account id.
2. Channels → Sync now. Exercises `pages_read_engagement`, `read_insights`,
   `instagram_basic`, `instagram_manage_insights`, `pages_read_user_content`.
3. Material → Add material → Save and draft. Drafts → Approve → Queue →
   Publish now. Exercises `pages_manage_posts` and
   `instagram_content_publish`.
4. Post a comment and send a message to the page from another account; Sync
   now; Inbox → Send reply. Exercises `pages_messaging`,
   `pages_manage_engagement`, `instagram_manage_comments`,
   `instagram_manage_messages`.
5. Submit a test lead form (Ads Manager → Lead ads testing tool). It must
   appear under Needs you within a minute. Exercises `leads_retrieval`.
6. Money → Ads → Connect an ad account with a token from the app; Sync now.
   Exercises `ads_read`.

## App Review submission

One submission covering all use cases. Each permission needs a paragraph and
a screencast; the paragraphs below can be pasted as written. Record the
screencast in the console on a connected test page, showing the login, the
action, and the result on Facebook or Instagram.

**Who we are.** MeSquared OS is an operations and marketing platform run by
Me² for small businesses. Each business is a separate workspace. The
business's own staff and Me²'s operators sign in; customers never do.

**pages_show_list, pages_manage_metadata.** List the pages the signed-in
admin manages so they can pick which page to connect, and subscribe that page
to webhooks so new leads, comments and messages reach the workspace.

**pages_manage_posts, instagram_content_publish.** Publish posts the
business has approved, at the scheduled time, to its own page and Instagram
account. Screencast: approve a draft, publish it, show it on the page.

**pages_read_engagement, pages_read_user_content, read_insights,
instagram_basic, instagram_manage_insights.** Read the page's and account's
comments, reviews, reach and follower numbers so the business sees, in one
place, how its channels are doing and what needs a reply. Screencast: Sync
now, then the Channels numbers and the inbox.

**pages_manage_engagement, instagram_manage_comments.** Reply to comments on
the business's own posts as the business, after a person has approved the
reply. Screencast: a comment arrives, the reply is edited and sent, shown on
the post.

**pages_messaging, instagram_manage_messages.** Reply to messages sent to the
page or account, as the business, within the standard messaging window.
Screencast: a message arrives in the inbox, a person replies, shown in
Messenger.

**leads_retrieval, pages_manage_ads.** Receive lead-form submissions from the
business's own lead ads and show them to the business so a person can call
back within minutes. Screencast: submit a test lead, show it in Needs you.

**ads_read.** Read daily spend and results from the business's own ad
accounts to show cost per lead and warn when the month is running over
budget. Screencast: connect the ad account, Sync now, the Ads tab.

## After approval

Switch the app from development to live (Settings → Basic). Then connect
APN's real page, Instagram account and ad account in the console and switch
on the social sync, publishing and inbox triage automations one at a time.
