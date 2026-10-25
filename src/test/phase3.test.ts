import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { buildCalendar, calendarGap, nextFreeSlot, upcomingSlots } from "@/lib/content/calendar";
import { applyFooter, checkCompliance } from "@/lib/content/compliance";
import { generateFromSource, ingestSource, registerContentEngine, runContentBatch, scheduleApproved } from "@/lib/content/engine";
import { contentEngineName, stubGenerator } from "@/lib/content/generate";
import { repository } from "@/lib/data";
import { demoTenants } from "@/lib/data/fixtures";
import { emit } from "@/lib/events";
import { parseMetaInboxEvents } from "@/lib/intake/channels/meta";
import { tick } from "@/lib/jobs/tick";
import { ingestInboxItems, replyToConversation, stubTriage } from "@/lib/social/inbox";
import { summarizeChannels } from "@/lib/social/metrics";
import { publishDuePosts, publishPost } from "@/lib/social/publish";
import { hasRealProvider } from "@/lib/social/providers";
import type { BrandProfileRecord } from "@/lib/types";

const harbor = demoTenants[0];
const summit = demoTenants[1];

before(() => {
  process.env.MESSAGING_MODE = "log";
  process.env.SOCIAL_MODE = "log";
  process.env.CONTENT_ENGINE = "stub";
  process.env.DEFAULT_FROM_EMAIL = "hello@example.com";
  registerContentEngine();
});

const reBrand: BrandProfileRecord = {
  voice: "Local and calm.",
  examples: [],
  bannedPhrases: ["guaranteed rent", "best price ever"],
  complianceBlock: { requiredFooter: "Harbor Realty Group | RLA 000000", prohibitedCombinations: ["separate vendors in one asset"], mustNot: ["invent statistics"] },
};

describe("compliance block", () => {
  it("blocks banned phrases and hype, flags prices, names, claims and stale years for client sign-off", () => {
    const r = checkCompliance({ text: "Guaranteed rent for every landlord! Chloe Baptiste lost 12 kg. Leased at $620 per week, 40% faster than 2019.\n\nHarbor Realty Group | RLA 000000", platform: "FACEBOOK", brand: reBrand, tenant: harbor });
    const codes = r.issues.map((i) => i.code);
    assert.ok(codes.includes("BANNED_PHRASE") && codes.includes("HYPE"), `blocks: ${codes}`);
    assert.ok(codes.includes("PRICE") && codes.includes("NAMED_PERSON") && codes.includes("CLAIM") && codes.includes("STALE_NUMBER"), `signoff: ${codes}`);
    assert.equal(r.ok, false);
    assert.equal(r.needsClientSignoff, true);
  });

  it("passes a plain post, requires and applies the footer, and never combines two properties", () => {
    const plain = applyFooter("Three owners told us the same thing this month: nobody called back. We do.", reBrand);
    assert.ok(plain.endsWith("Harbor Realty Group | RLA 000000"));
    const r = checkCompliance({ text: plain, platform: "FACEBOOK", brand: reBrand, tenant: harbor });
    assert.equal(r.ok, true);
    assert.equal(r.needsClientSignoff, false);
    const missing = checkCompliance({ text: "No footer here.", platform: "FACEBOOK", brand: reBrand, tenant: harbor });
    assert.ok(missing.issues.some((i) => i.code === "MISSING_FOOTER"));
    const combined = checkCompliance({ text: "Two homes: 12 Marine Parade and 4 Harbour View Street both open Saturday.\n\nHarbor Realty Group | RLA 000000", platform: "FACEBOOK", brand: reBrand, tenant: harbor });
    assert.ok(combined.issues.some((i) => i.code === "COMBINED_SUBJECTS" && i.severity === "block"));
    const long = checkCompliance({ text: "x".repeat(1500), platform: "GOOGLE_BUSINESS", brand: null, tenant: harbor });
    assert.ok(long.issues.some((i) => i.code === "TOO_LONG"));
  });
});

describe("content engine", () => {
  it("uses the stub without a model key and shapes one draft per channel within limits", async () => {
    assert.equal(contentEngineName({}), "stub");
    assert.equal(contentEngineName({ ANTHROPIC_API_KEY: "k" }), "anthropic");
    const drafts = await stubGenerator.draft({ tenant: harbor, brand: reBrand, source: { title: "Owners switching", text: "Three owners told us the same thing. Nobody called them back. We call back the same day.", kind: "RAW_TEXT" }, platforms: ["FACEBOOK", "TIKTOK", "YOUTUBE", "GOOGLE_BUSINESS"], services: ["appraisal", "property management"] });
    assert.equal(drafts.length, 4);
    assert.match(drafts.find((d) => d.platform === "TIKTOK")!.body, /0–3s/);
    assert.equal(drafts.find((d) => d.platform === "GOOGLE_BUSINESS")!.hashtags.length, 0, "no hashtags on Google Business");
    assert.ok(drafts.every((d) => d.body.length <= 2500));
  });

  it("drafts from source material once per channel, applies the footer, flags sign-off, and approval lands on the calendar", async () => {
    const source = await ingestSource(harbor, { kind: "RAW_TEXT", title: "Appraisal walk-through", body: "What happens at a rental appraisal. We look at the condition, the street, and recent lets nearby. You get a written estimate within a day.", origin: "operator" });
    const first = await generateFromSource(harbor, source.id);
    assert.equal(first.skipped, null);
    assert.equal(first.drafts.length, 3, "one draft per connected channel (FB, IG, YouTube)");
    assert.ok(first.drafts.every((d) => d.status === "IN_REVIEW" && d.parentId === source.id));
    assert.ok(first.drafts.every((d) => d.generation.compliance?.ok), "stub drafts pass compliance");
    const again = await generateFromSource(harbor, source.id);
    assert.equal(again.drafts.length, 0, "idempotent per source");
    assert.match(again.skipped ?? "", /already exist/);

    const fb = first.drafts.find((d) => d.targetPlatform === "FACEBOOK")!;
    await repository.updateContentAssetStatus(harbor.id, fb.id, "APPROVED");
    const { post, when } = await scheduleApproved(harbor, { ...fb, status: "APPROVED" });
    assert.ok(post && when, "scheduled");
    assert.equal(post!.status, "SCHEDULED", "harbor has a Facebook channel");
    assert.ok(when!.getTime() > Date.now());
    const twice = await scheduleApproved(harbor, { ...fb, status: "APPROVED" });
    assert.equal(twice.post!.id, post!.id, "approving twice never creates two posts");
    const runs = await repository.listAutomationRuns(harbor.id, 50);
    assert.ok(runs.some((r) => r.typeKey === "content_engine" && /Drafted 3 posts/.test(r.summary)));
    assert.ok(!runs.some((r) => /operator|workspace/i.test(r.summary)), "no internal words");
  });

  it("names and prices in the material make the draft need client sign-off", async () => {
    const source = await ingestSource(summit, { kind: "RAW_TEXT", title: "Jordan's result", body: "Jordan Lee joined in June and finished the 10k on Sunday. Memberships are $29 a week with no lock-in.", origin: "operator" });
    const { drafts } = await generateFromSource(summit, source.id, { platforms: ["INSTAGRAM"] });
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].needsClientSignoff, true);
    const codes = drafts[0].generation.compliance!.issues.map((i) => i.code);
    assert.ok(codes.includes("NAMED_PERSON") && codes.includes("PRICE"));
  });

  it("a good review becomes source material and is drafted; a poor one is not", async () => {
    const before = (await repository.listContentAssets(summit.id, { kinds: ["RAW_TEXT"], limit: 100 })).length;
    const good = await repository.upsertReview(summit.id, { provider: "Google", externalId: "rv_p3_good", authorName: "Priya N.", rating: 5, body: "The coaches remembered my name on day two and built the plan around my knee. Three months in and I look forward to Mondays.", url: null, receivedAt: new Date() });
    await emit(summit.id, "review.received", { reviewId: good.record.id, provider: "Google", rating: 5 });
    const bad = await repository.upsertReview(summit.id, { provider: "Google", externalId: "rv_p3_bad", authorName: "Sam", rating: 2, body: "Too crowded at 6pm and the showers were cold again. Not what I pay for.", url: null, receivedAt: new Date() });
    await emit(summit.id, "review.received", { reviewId: bad.record.id, provider: "Google", rating: 2 });
    const sources = await repository.listContentAssets(summit.id, { kinds: ["RAW_TEXT"], limit: 100 });
    assert.equal(sources.length, before + 1, "only the good review became material");
    const reviewSource = sources.find((s) => s.generation.sourceRef === good.record.id)!;
    const drafts = await repository.listContentAssets(summit.id, { parentId: reviewSource.id, limit: 10 });
    assert.ok(drafts.length >= 1, "drafted from the review");
    assert.ok(drafts.every((d) => d.needsClientSignoff), "a customer's name needs client sign-off");
  });

  it("the daily batch flags a thin calendar for an operator", async () => {
    const result = await runContentBatch(summit);
    const exceptions = await repository.listExceptions([summit.id]);
    assert.equal(exceptions.some((e) => /scheduled for the next 7 days/.test(e.reason)), result.gap > 0, "a gap exception exists exactly when the batch found a gap");
  });
});

describe("calendar", () => {
  it("finds the next free slot in the tenant's timezone and skips taken ones", () => {
    const from = new Date("2026-11-02T00:00:00Z"); // Monday 10:30 Adelaide
    const slots = upcomingSlots(harbor, [{ day: 1, hour: 9 }, { day: 3, hour: 9 }], from, 3);
    assert.equal(slots.length, 3);
    // Monday 09:00 Adelaide (ACDT, +10:30) has passed by 10:30, so the first slot is Wednesday.
    assert.equal(slots[0].toISOString(), "2026-11-03T22:30:00.000Z");
    const free = nextFreeSlot(harbor, [{ day: 1, hour: 9 }, { day: 3, hour: 9 }], [slots[0]], from);
    assert.equal(free.toISOString(), slots[1].toISOString());
    const days = buildCalendar(harbor, [], [], from, 7);
    assert.equal(days.length, 7);
    assert.equal(days[0].date, "2026-11-02");
    assert.equal(days[0].isToday, true);
  });

  it("measures the gap against the cadence", () => {
    const now = new Date();
    const posts = [{ scheduledFor: new Date(now.getTime() + 86_400_000), status: "SCHEDULED" }, { scheduledFor: new Date(now.getTime() + 10 * 86_400_000), status: "SCHEDULED" }] as never;
    const gap = calendarGap(posts, { postsPerWeek: 3 }, now);
    assert.deepEqual(gap, { scheduled: 1, target: 3, short: 2 });
  });
});

describe("publishing", () => {
  it("claims due posts once, logs a simulated publish honestly, and marks the asset published", async () => {
    assert.equal(hasRealProvider("FACEBOOK"), false, "SOCIAL_MODE=log");
    const [post] = await repository.createSocialPosts(harbor.id, [{ channelId: "ch_1", contentAssetId: null, platform: "FACEBOOK", caption: "Due now test post", status: "SCHEDULED", scheduledFor: new Date(Date.now() - 60_000) }]);
    const result = await publishDuePosts(new Date());
    assert.ok(result.simulated >= 1);
    const after = await repository.findSocialPostById(harbor.id, post.id);
    assert.equal(after?.status, "PUBLISHED");
    assert.ok(after?.externalPostId?.startsWith("log_"));
    const again = await publishDuePosts(new Date());
    assert.equal(again.simulated + again.published, 0, "nothing left to publish");
    const runs = await repository.listAutomationRuns(harbor.id, 50);
    assert.ok(runs.some((r) => r.typeKey === "social_publish" && r.outcome === "SKIPPED" && /nothing went out/.test(r.summary)), "simulated publish is called out");
  });

  it("a post with no channel fails with an exception rather than silently", async () => {
    const [post] = await repository.createSocialPosts(summit.id, [{ channelId: null, contentAssetId: null, platform: "LINKEDIN", caption: "No channel here", status: "SCHEDULED", scheduledFor: new Date(Date.now() - 60_000) }]);
    await publishDuePosts(new Date());
    const after = await repository.findSocialPostById(summit.id, post.id);
    assert.equal(after?.status, "FAILED");
    assert.ok((await repository.listExceptions([summit.id])).some((e) => /LinkedIn post failed/.test(e.reason)));
    const now = await publishPost(summit, post.id);
    assert.equal(now.ok, false, "publish now also reports the missing channel");
  });

  it("the tick publishes and queues the daily batch and hourly sync", async () => {
    const result = await tick(new Date());
    assert.ok(typeof result.published === "number");
    const due = await repository.listDueActions(new Date(Date.now() + 2 * 86_400_000));
    assert.ok(due.some((a) => a.typeKey === "social_sync") || result.actionsRun > 0, "sync queued or already run");
  });
});

describe("unified inbox", () => {
  it("parses Meta comments and messages, dropping the page's own", () => {
    const events = parseMetaInboxEvents({
      object: "page",
      entry: [
        { id: "page_1", changes: [{ field: "feed", value: { item: "comment", verb: "add", comment_id: "c1", post_id: "p1", message: "Is the Glenelg unit still available?", from: { id: "u1", name: "Dana K" }, created_time: 1_700_000_000 } }, { field: "feed", value: { item: "comment", verb: "add", comment_id: "c2", post_id: "p1", message: "Yes!", from: { id: "page_1", name: "Harbor" } } }] },
        { id: "page_1", messaging: [{ sender: { id: "u2" }, recipient: { id: "page_1" }, timestamp: 1_700_000_000_000, message: { mid: "m1", text: "Hi, do you manage units in Brighton?" } }, { sender: { id: "page_1" }, message: { mid: "m2", text: "echo", is_echo: true } }] },
      ],
    });
    assert.equal(events.length, 2);
    assert.equal(events[0].kind, "COMMENT");
    assert.equal(events[1].kind, "DM");
    assert.equal(events[1].threadId, "dm:u2");
  });

  it("ingests items once, triages them, files enquiries as leads and drafts replies", async () => {
    const channel = (await repository.listChannels(harbor.id)).find((c) => c.platform === "FACEBOOK")!;
    const items = [
      { externalId: "c_lead_1", threadId: "post_x", kind: "COMMENT" as const, authorName: "Dana K", authorId: "u1", text: "Is the Glenelg unit still available and how much is the rent?", receivedAt: new Date(), postExternalId: "post_x" },
      { externalId: "c_thanks_1", threadId: "post_y", kind: "COMMENT" as const, authorName: "Lee", authorId: "u3", text: "Thanks so much, you were brilliant with our move", receivedAt: new Date(), postExternalId: "post_y" },
      { externalId: "d_complaint_1", threadId: "dm:u4", kind: "DM" as const, authorName: null, authorId: "u4", text: "Honestly the worst experience, nobody called back for a week. I want a refund.", receivedAt: new Date() },
    ];
    const fresh = await ingestInboxItems(harbor, channel, items);
    assert.equal(fresh, 3);
    assert.equal(await ingestInboxItems(harbor, channel, items), 0, "same items are not recorded twice");
    const inbox = await repository.listInboxConversations(harbor.id, { awaitingOnly: true });
    assert.ok(inbox.length >= 3);
    const lead = inbox.find((c) => c.externalId === "post_x")!;
    assert.equal(lead.meta?.intent, "lead");
    assert.ok(lead.suggestedReply, "a reply is drafted");
    assert.ok((await repository.listExceptions([harbor.id])).some((e) => /asked about something in a public comment/.test(e.reason)), "enquiry flagged for a fast reply");
    assert.ok((await repository.listExceptions([harbor.id])).some((e) => /unhappy/.test(e.reason)), "complaint flagged for a person");
    assert.equal(stubTriage("Thanks heaps!").routine, true);
    assert.equal(stubTriage("How much is a membership?").intent, "lead");

    const reply = await replyToConversation(harbor, lead.id, "Thanks Dana, it is! Someone will message you with the details.", "OPERATOR");
    assert.equal(reply.ok, true);
    const afterReply = await repository.findConversationById(harbor.id, lead.id);
    assert.equal(afterReply?.awaitingReply, false);
    const msgs = await repository.listMessages(harbor.id, lead.id);
    assert.equal(msgs.length, 2);
    assert.equal(msgs[1].direction, "OUTBOUND");
  });
});

describe("channel analytics", () => {
  it("summarises followers and the week's reach per channel from snapshots", async () => {
    const channels = await repository.listChannels(harbor.id);
    const snapshots = await repository.listChannelMetrics(harbor.id, { since: new Date(Date.now() - 14 * 86_400_000) });
    const summary = summarizeChannels(channels, snapshots);
    const fb = summary.find((s) => s.channel.platform === "FACEBOOK")!;
    assert.equal(fb.followers, 2140);
    assert.ok((fb.reach7d ?? 0) > 0);
    const yt = summary.find((s) => s.channel.platform === "YOUTUBE")!;
    assert.equal(yt.followers, null, "no numbers yet for a channel without snapshots");
  });
});
