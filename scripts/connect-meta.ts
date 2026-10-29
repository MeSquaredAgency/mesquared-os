/**
 * Connects a workspace's Facebook page and Instagram business account through
 * the Meta app, against whatever DATABASE_URL points at. One short-lived user
 * token from Graph API Explorer (signed in as an admin of the page, with the
 * app's permissions ticked) is all it needs: it exchanges that for a
 * long-lived user token, finds the page and its page token (which does not
 * expire), subscribes the page to the app's webhooks, and stores the page
 * token encrypted on the workspace's META integration with one channel per
 * surface. Tokens are read from environment variables, never from the
 * command line, so they stay out of shell history, and nothing is printed
 * but ids, names, the granted scopes and the expiry.
 *
 *   META_APP_ID=... META_APP_SECRET=... META_USER_TOKEN=... \
 *     npm run tenant:connect-meta -- <workspace-slug> [page-id]
 *
 * With several pages on the account and no page id given, it lists them and
 * stops. Re-running replaces the stored token and keeps the channels.
 */
import assert from "node:assert/strict";
import { dataMode, repository } from "@/lib/data";
import { connectMetaChannels, exchangeForLongLivedUserToken, inspectToken, listManagedPages, PAGE_WEBHOOK_FIELDS, subscribePageToApp } from "@/lib/social/meta-connect";

const [slug, wantedPageId] = process.argv.slice(2);
assert.ok(slug, "usage: META_APP_ID=… META_APP_SECRET=… META_USER_TOKEN=… npm run tenant:connect-meta -- <workspace-slug> [page-id]");
const appId = process.env.META_APP_ID;
const appSecret = process.env.META_APP_SECRET;
const userToken = process.env.META_USER_TOKEN;
assert.ok(appId, "META_APP_ID is empty (Meta app dashboard → Settings → Basic → App ID)");
assert.ok(appSecret, "META_APP_SECRET is empty (Settings → Basic → App secret)");
assert.ok(userToken, "META_USER_TOKEN is empty (Graph API Explorer → Generate access token, signed in as a page admin)");

const tenant = await repository.findTenantBySlug(slug);
assert.ok(tenant, `no workspace with slug ${slug}`);

const longLived = await exchangeForLongLivedUserToken(userToken, appId, appSecret);
assert.ok(longLived.ok, `could not exchange the user token: ${longLived.ok ? "" : longLived.error}`);

const pages = await listManagedPages(longLived.value.accessToken);
assert.ok(pages.ok, `could not list pages: ${pages.ok ? "" : pages.error}`);
assert.ok(pages.value.length > 0, "the signed-in user administers no pages, or pages_show_list was not granted");

const page = wantedPageId ? pages.value.find((p) => p.id === wantedPageId) : pages.value.length === 1 ? pages.value[0] : undefined;
if (!page) {
  console.log(wantedPageId ? `No page with id ${wantedPageId} on this account. Pages found:` : "More than one page on this account; run again with the page id:");
  for (const p of pages.value) console.log(`  ${p.id}  ${p.name}${p.instagram ? `  (Instagram: @${p.instagram.username ?? p.instagram.id})` : "  (no Instagram business account linked)"}`);
  process.exit(1);
}

const subscribed = await subscribePageToApp(page.id, page.accessToken);
assert.ok(subscribed.ok, `could not subscribe the page to the app's webhooks: ${subscribed.ok ? "" : subscribed.error}`);

const info = await inspectToken(page.accessToken, appId, appSecret);
if (info.ok) {
  assert.ok(info.value.isValid, "Meta reports the page token as invalid");
  assert.equal(info.value.expiresAt, null, `the page token expires at ${info.value.expiresAt?.toISOString()}; a page token derived from a long-lived user token should never expire`);
}

const result = await connectMetaChannels(tenant.id, { pageId: page.id, pageName: page.name, pageToken: page.accessToken, instagram: page.instagram });

console.log(`Connected ${tenant.name} (${dataMode}):`);
console.log(`  Facebook page   ${page.name} (${page.id}), subscribed to ${PAGE_WEBHOOK_FIELDS.join(", ")}`);
console.log(result.instagram ? `  Instagram       ${result.instagram.displayName ?? result.instagram.externalAccountId} (${result.instagram.externalAccountId})` : "  Instagram       none linked to this page; link it in the page's settings and run again");
if (info.ok) console.log(`  Token           ${info.value.type ?? "?"}, ${info.value.expiresAt ? `expires ${info.value.expiresAt.toISOString()}` : "never expires"}; scopes: ${info.value.scopes.join(", ") || "none reported"}`);
console.log("Next: Content and social → Channels → Sync now, then the rest of docs/runbooks/meta-app.md.");
