import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { registerAutomations } from "@/lib/automations/handlers";
import { settleException } from "@/lib/console/resolve";
import { repository } from "@/lib/data";
import { demoTenants } from "@/lib/data/fixtures";
import { detectForTenant } from "@/lib/opportunities/detect";
import { conversationPlace, loadOpportunityDetail, subjectIdOf } from "@/lib/opportunities/detail";
import { raiseMissedOpportunity } from "@/lib/opportunities/raise";
import { ingestInboxItems } from "@/lib/social/inbox";

const summit = demoTenants[1];
const harbor = demoTenants[0];

before(() => {
  process.env.MESSAGING_MODE = "log";
  process.env.CONTENT_ENGINE = "stub";
  registerAutomations();
});

describe("missed opportunity detail", () => {
  it("names the sender and shows the thread for an unreplied Instagram message", async () => {
    const { record: convo } = await repository.upsertSocialConversation(summit.id, { channelId: "ch_detail_test", platform: "INSTAGRAM", channel: "SOCIAL_DM", externalId: "ig_detail_thread", displayName: "Jas", meta: {} });
    await repository.recordMessage(summit.id, { contactId: null, channel: "SOCIAL_DM", direction: "INBOUND", sender: "CONTACT", body: "Is the Saturday class still on?", status: "RECEIVED", externalConversationId: "ig_detail_thread" });

    await detectForTenant(summit, new Date(Date.now() + 3 * 60 * 60_000));
    const item = (await repository.listMissedOpportunities(summit.id, { limit: 500 })).find((m) => m.dedupeKey === `UNREPLIED_DM:${convo.id}`);
    assert.ok(item, "raised for the thread");
    assert.match(item.summary, /^Jas sent a message on Instagram /, "the platform's name for the sender, not \"Someone\"");

    const detail = await loadOpportunityDetail(summit.id, item.id, { onlyAssigneeId: null });
    assert.ok(detail);
    assert.equal(detail.person?.name, "Jas");
    assert.equal(detail.where, "Instagram message");
    assert.deepEqual(detail.messages.map((m) => [m.from, m.body]), [["them", "Is the Saturday class still on?"]]);
    assert.equal(detail.awaitingReply, true);
    assert.ok(detail.suggestedAction, "the exception's suggested action comes through");
    assert.ok(detail.trail.some((t) => t.outcome === "ESCALATED"), "the log of what we did");
  });

  it("puts the name into an older item that only says Someone", async () => {
    const { record: convo } = await repository.upsertSocialConversation(summit.id, { channelId: "ch_detail_test", platform: "FACEBOOK", channel: "SOCIAL_DM", externalId: "fb_detail_thread", displayName: "Rowan", meta: {} });
    const mo = await raiseMissedOpportunity(summit, { type: "UNREPLIED_DM", leadId: null, contactId: null, subjectId: convo.id, summary: "Someone sent a message 2 hours ago and hasn't had a reply.", suggestedAction: "Reply from the inbox." });
    assert.ok(mo);
    const detail = await loadOpportunityDetail(summit.id, mo.id, { onlyAssigneeId: null });
    assert.equal(detail?.headline, "Rowan sent a message 2 hours ago and hasn't had a reply.");
  });

  it("hides an item from a member who sees only their own leads unless the lead is theirs", async () => {
    const lead = (await repository.listRecentLeads(harbor.id, 50))[0];
    assert.ok(lead, "a demo lead");
    const mo = await raiseMissedOpportunity(harbor, { type: "QUIET_QUOTE", leadId: lead.id, contactId: lead.contactId, subjectId: `${lead.id}:detail-test`, summary: "Detail test", suggestedAction: "Nudge them." });
    assert.ok(mo);
    assert.equal(await loadOpportunityDetail(harbor.id, mo.id, { onlyAssigneeId: "user_not_assigned" }), null);
    if (lead.assigneeId) assert.ok(await loadOpportunityDetail(harbor.id, mo.id, { onlyAssigneeId: lead.assigneeId }));
    assert.equal(await loadOpportunityDetail(summit.id, mo.id, { onlyAssigneeId: null }), null, "another workspace can't open it");
  });

  it("reads the subject from a dedupe key and names each channel", () => {
    assert.equal(subjectIdOf("UNREPLIED_DM:cv_1"), "cv_1");
    assert.equal(subjectIdOf("NO_SHOW:bk_1:extra"), "bk_1:extra");
    assert.equal(conversationPlace({ channel: "SOCIAL_COMMENT", platform: "FACEBOOK" }), "Facebook comment");
    assert.equal(conversationPlace({ channel: "SMS", platform: null }), "Text message");
  });
});

describe("spam and closed items leave the inbox", () => {
  it("keeps a spam thread set aside when it ends on a harmless-looking message", async () => {
    const channel = (await repository.listChannels(harbor.id)).find((c) => c.platform === "FACEBOOK");
    assert.ok(channel, "a demo Facebook channel");
    // The shape of a real one: a greeting, the pitch, and a photo with no text.
    const sent = ["Hello 👋", "I'm professional Google Maps and Facebook page positive reviews providers. Also Instagram followers, likes and views.", "We can remove your negative reviews; you may make the payment after.", ""];
    const items = sent.map((text, i) => ({ externalId: `spam_seq_${i}`, threadId: "dm:spam_seq", kind: "DM" as const, authorName: "Spammy Seller", authorId: "spam_seq", text, receivedAt: new Date() }));
    for (const item of items) await ingestInboxItems(harbor, channel, [item]);
    const convo = (await repository.listInboxConversations(harbor.id, {})).find((c) => c.externalId === "dm:spam_seq");
    assert.ok(convo);
    assert.equal(convo.meta?.intent, "spam", "the closing photo is judged with the pitch before it");
    assert.equal(convo.awaitingReply, false, "so it never waits for a reply or becomes a missed opportunity");
  });

  it("takes a thread off the inbox when its item is closed from the queue", async () => {
    const { record: convo } = await repository.upsertSocialConversation(summit.id, { channelId: "ch_detail_test", platform: "FACEBOOK", channel: "SOCIAL_DM", externalId: "fb_close_thread", displayName: "Quinn", meta: {} });
    await repository.recordMessage(summit.id, { contactId: null, channel: "SOCIAL_DM", direction: "INBOUND", sender: "CONTACT", body: "Hi there", status: "RECEIVED", externalConversationId: "fb_close_thread" });
    const mo = await raiseMissedOpportunity(summit, { type: "UNREPLIED_DM", leadId: null, contactId: null, subjectId: convo.id, summary: "Quinn sent a message", suggestedAction: "Reply from the inbox." });
    assert.ok(mo);
    const ex = (await repository.listExceptions([summit.id])).find((e) => e.missedOpportunityId === mo.id);
    assert.ok(ex, "flagged for a person");
    assert.equal((await repository.findConversationById(summit.id, convo.id))?.awaitingReply, true);

    await settleException(summit.id, ex.id, "no longer relevant", false, "user_ops");
    assert.equal((await repository.findMissedOpportunityById(summit.id, mo.id))?.status, "EXPIRED");
    assert.equal((await repository.findConversationById(summit.id, convo.id))?.awaitingReply, false, "no longer waiting in the inbox");

    await repository.recordMessage(summit.id, { contactId: null, channel: "SOCIAL_DM", direction: "INBOUND", sender: "CONTACT", body: "Are you there?", status: "RECEIVED", externalConversationId: "fb_close_thread" });
    assert.equal((await repository.findConversationById(summit.id, convo.id))?.awaitingReply, true, "a new message brings it back");
  });
});
