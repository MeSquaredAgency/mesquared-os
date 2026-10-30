import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { repository } from "@/lib/data";
import { parseMetaInboxEvents } from "@/lib/intake/channels/meta";
import { connectMetaChannels } from "@/lib/social/meta-connect";
import { ingestMetaWebhookInbox, resolveMetaInboxTarget } from "@/lib/social/meta-webhook";
import { provisionTenant } from "@/lib/tenants/provision";
import type { TenantSummary } from "@/lib/types";

/**
 * Meta delivers `page` webhooks with the Facebook page id as the entry id and
 * `instagram` webhooks with the Instagram business account id. The META
 * integration row is keyed by the page id only, so Instagram events must
 * resolve their tenant through the Instagram channel.
 */

let harbour: TenantSummary;
let summit: TenantSummary;

const PAGE_A = "111";
const IG_A = "178";
const PAGE_B = "222";
const IG_B = "288";

function instagramComment(entryId: string, commentId: string, text: string) {
  return { object: "instagram", entry: [{ id: entryId, time: 1_700_000_000, changes: [{ field: "comments", value: { id: commentId, text, from: { id: "ig_user_1", username: "dana.k" }, media: { id: "media_1", media_product_type: "FEED" } } }] }] };
}

function instagramMessage(entryId: string, mid: string, text: string) {
  return { object: "instagram", entry: [{ id: entryId, time: 1_700_000_000, messaging: [{ sender: { id: "ig_user_2" }, recipient: { id: entryId }, timestamp: 1_700_000_000_000, message: { mid, text } }] }] };
}

function pageComment(entryId: string, commentId: string, text: string) {
  return { object: "page", entry: [{ id: entryId, time: 1_700_000_000, changes: [{ field: "feed", value: { item: "comment", verb: "add", comment_id: commentId, post_id: "post_1", message: text, from: { id: "fb_user_1", name: "Lee" }, created_time: 1_700_000_000 } }] }] };
}

before(async () => {
  process.env.MESSAGING_MODE = "log";
  process.env.SOCIAL_MODE = "log";
  process.env.CONTENT_ENGINE = "stub";
  harbour = await provisionTenant({ templateKey: "real_estate", name: "Routing Harbour", slug: "", region: "au", timezone: "Australia/Adelaide", locale: "en-AU", currency: "aud", fromName: "Harbour", replyTo: "harbour@routing.example", serviceAreas: ["Adelaide"], requiredFooter: "Routing Harbour | RLA 000010" });
  summit = await provisionTenant({ templateKey: "real_estate", name: "Routing Summit", slug: "", region: "au", timezone: "Australia/Adelaide", locale: "en-AU", currency: "aud", fromName: "Summit", replyTo: "summit@routing.example", serviceAreas: ["Adelaide"], requiredFooter: "Routing Summit | RLA 000011" });
  await connectMetaChannels(harbour.id, { pageId: PAGE_A, pageName: "Harbour page", pageToken: "PAGE_A", instagram: { id: IG_A, username: "harbour" } });
  await connectMetaChannels(summit.id, { pageId: PAGE_B, pageName: "Summit page", pageToken: "PAGE_B", instagram: { id: IG_B, username: "summit" } });
});

describe("parseMetaInboxEvents carries the webhook object", () => {
  it("marks page events as page and Instagram events as instagram, keeping the entry id", () => {
    const page = parseMetaInboxEvents(pageComment(PAGE_A, "c_obj_1", "Still available?"));
    assert.equal(page.length, 1);
    assert.equal(page[0].object, "page");
    assert.equal(page[0].pageId, PAGE_A);
    const ig = parseMetaInboxEvents(instagramComment(IG_A, "c_obj_2", "Price?"));
    assert.equal(ig.length, 1);
    assert.equal(ig[0].object, "instagram");
    assert.equal(ig[0].pageId, IG_A);
    assert.equal(ig[0].kind, "COMMENT");
    const dm = parseMetaInboxEvents(instagramMessage(IG_A, "m_obj_1", "Hi there"));
    assert.equal(dm.length, 1);
    assert.equal(dm[0].object, "instagram");
    assert.equal(dm[0].kind, "DM");
  });
});

describe("repository.findTenantByChannelAccount", () => {
  it("finds the tenant by the Instagram channel's account id and by settings.igUserId", async () => {
    assert.equal((await repository.findTenantByChannelAccount("INSTAGRAM", IG_A))?.id, harbour.id);
    assert.equal((await repository.findTenantByChannelAccount("INSTAGRAM", IG_B))?.id, summit.id);
    // A channel keyed by something else but carrying the IG id in its settings still resolves.
    await repository.upsertChannel(summit.id, { platform: "INSTAGRAM", externalAccountId: "legacy_handle", displayName: "@legacy", integrationId: null, isActive: true, settings: { igUserId: "17_legacy" } });
    assert.equal((await repository.findTenantByChannelAccount("INSTAGRAM", "17_legacy"))?.id, summit.id);
  });

  it("ignores unknown ids, other platforms and inactive channels", async () => {
    assert.equal(await repository.findTenantByChannelAccount("INSTAGRAM", "999"), null);
    assert.equal(await repository.findTenantByChannelAccount("FACEBOOK", IG_A), null);
    await repository.upsertChannel(summit.id, { platform: "INSTAGRAM", externalAccountId: "retired_ig", displayName: null, integrationId: null, isActive: false, settings: { igUserId: "retired_ig" } });
    assert.equal(await repository.findTenantByChannelAccount("INSTAGRAM", "retired_ig"), null);
  });
});

describe("Meta webhook inbox routing", () => {
  it("lands an Instagram comment in the inbox of the tenant that owns that Instagram account", async () => {
    assert.equal(await repository.findTenantByIntegrationAccount("META", IG_A), null, "the META integration is keyed by the page id, so the old lookup misses the Instagram id");
    const target = await resolveMetaInboxTarget("instagram", IG_A);
    assert.ok(target);
    assert.equal(target.tenant.id, harbour.id);
    assert.equal(target.channel.platform, "INSTAGRAM");
    assert.equal(target.channel.externalAccountId, IG_A);

    const r = await ingestMetaWebhookInbox(instagramComment(IG_A, "ig_c_1", "Is the Glenelg unit still available?"));
    assert.equal(r.inboxNew, 1);
    assert.deepEqual(r.unresolved, []);
    const inbox = await repository.listInboxConversations(harbour.id);
    const convo = inbox.find((c) => c.externalId === "media_1");
    assert.ok(convo, "the comment thread is in the owner's inbox");
    assert.equal(convo.platform, "INSTAGRAM");
    assert.equal(convo.channelId, target.channel.id);
    assert.equal((await repository.listInboxConversations(summit.id)).some((c) => c.externalId === "media_1"), false, "the other tenant never sees it");
  });

  it("lands an Instagram DM the same way", async () => {
    const r = await ingestMetaWebhookInbox(instagramMessage(IG_B, "ig_m_1", "Do you manage units in Brighton?"));
    assert.equal(r.inboxNew, 1);
    const convo = (await repository.listInboxConversations(summit.id)).find((c) => c.externalId === "dm:ig_user_2");
    assert.ok(convo);
    assert.equal(convo.platform, "INSTAGRAM");
    assert.equal(convo.channel, "SOCIAL_DM");
  });

  it("still resolves a page webhook by the page id onto the Facebook channel", async () => {
    const target = await resolveMetaInboxTarget("page", PAGE_B);
    assert.ok(target);
    assert.equal(target.tenant.id, summit.id);
    assert.equal(target.channel.platform, "FACEBOOK");
    assert.equal(target.channel.externalAccountId, PAGE_B);

    const r = await ingestMetaWebhookInbox(pageComment(PAGE_B, "fb_c_1", "How much is the rent?"));
    assert.equal(r.inboxNew, 1);
    const convo = (await repository.listInboxConversations(summit.id)).find((c) => c.externalId === "post_1");
    assert.ok(convo);
    assert.equal(convo.platform, "FACEBOOK");
  });

  it("ignores an id no tenant owns", async () => {
    assert.equal(await resolveMetaInboxTarget("instagram", "999"), null);
    assert.equal(await resolveMetaInboxTarget("page", "999"), null);
    const r = await ingestMetaWebhookInbox(instagramComment("999", "ig_c_x", "Hello?"));
    assert.equal(r.inboxNew, 0);
    assert.deepEqual(r.unresolved, ["999"]);
  });

  it("does not record the same event twice", async () => {
    const again = await ingestMetaWebhookInbox(instagramComment(IG_A, "ig_c_1", "Is the Glenelg unit still available?"));
    assert.equal(again.inboxNew, 0);
  });
});
