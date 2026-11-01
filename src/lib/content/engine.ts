import { randomUUID } from "node:crypto";
import { repository } from "@/lib/data";
import type { NewSocialPost } from "@/lib/data/repository";
import { emit, subscribe } from "@/lib/events";
import { quoteUntrusted } from "@/lib/messaging/templates";
import { getTenantObjectUrl, isStorageConfigured, storageKeyFromFileUrl } from "@/lib/storage";
import type { ContentAssetRecord, SocialPlatform, TenantSummary } from "@/lib/types";
import { SOURCE_KINDS } from "@/lib/types";
import { calendarGap, nextFreeSlot, slotsFor } from "./calendar";
import { applyFooter, checkCompliance } from "./compliance";
import { getGenerator } from "./generate";
import { specFor } from "./platforms";
import { getTranscriber } from "./transcribe";

/**
 * The content engine: source material in, one compliance-checked draft per
 * enabled channel out, waiting for approval. Approval puts the asset on the
 * calendar as a scheduled post. A daily batch drafts from unused material and
 * flags a thin calendar; good reviews become source material automatically.
 */

export interface SourceInput {
  kind: "RAW_TEXT" | "RAW_AUDIO" | "RAW_VIDEO" | "IMAGE";
  title: string | null;
  body?: string | null;
  fileUrl?: string | null;
  origin: "operator" | "upload" | "review" | "api";
  sourceRef?: string | null;
}

async function engineSettings(tenantId: string) {
  const cfg = await repository.getTenantConfig(tenantId);
  const automation = cfg.automations.find((a) => a.typeKey === "content_engine");
  const contentModule = cfg.modules.find((m) => m.moduleKey === "content");
  return { enabled: Boolean(automation?.enabled) && (contentModule?.enabled ?? true), settings: automation?.settings ?? {}, moduleSettings: contentModule?.settings ?? {}, brand: cfg.brand };
}

/** Records a new piece of source material. Does not generate; call generateFromSource (or let the batch pick it up). */
export async function ingestSource(tenant: TenantSummary, input: SourceInput): Promise<ContentAssetRecord> {
  const [asset] = await repository.createContentAssets(tenant.id, [
    { kind: input.kind, title: input.title?.slice(0, 200) ?? null, body: input.body?.slice(0, 20_000) ?? null, fileUrl: input.fileUrl ?? null, targetPlatform: null, status: "DRAFT", needsClientSignoff: false, tags: [], scheduledFor: null, generation: { origin: input.origin, sourceRef: input.sourceRef ?? null } },
  ]);
  await emit(tenant.id, "content.source.created", { assetId: asset.id, kind: asset.kind, origin: input.origin });
  return asset;
}

/** The text the engine can work from: the body, an existing transcript, or a fresh one when a transcriber is configured. */
export async function sourceText(tenant: TenantSummary, source: ContentAssetRecord): Promise<{ text: string; transcript: ContentAssetRecord | null } | { text: null; reason: string }> {
  if (source.body?.trim()) return { text: source.body.trim(), transcript: null };
  const children = await repository.listContentAssets(tenant.id, { parentId: source.id, kinds: ["TRANSCRIPT"], limit: 1 });
  if (children[0]?.body) return { text: children[0].body, transcript: children[0] };
  if (source.kind !== "RAW_AUDIO" && source.kind !== "RAW_VIDEO") return { text: null, reason: "This material has no text to work from. Add a short description or paste the words." };
  const transcriber = getTranscriber();
  const key = storageKeyFromFileUrl(source.fileUrl);
  if (!transcriber) return { text: null, reason: "Transcription isn't set up (DEEPGRAM_API_KEY), so paste the transcript to draft from this recording." };
  if (!key || !isStorageConfigured()) return { text: null, reason: "The recording isn't in storage, so it can't be transcribed." };
  const url = await getTenantObjectUrl(tenant.id, key, 900);
  const { text, durationSeconds } = await transcriber.transcribe(url);
  const [transcript] = await repository.createContentAssets(tenant.id, [{ kind: "TRANSCRIPT", parentId: source.id, title: `Transcript — ${source.title ?? "recording"}`, body: text, targetPlatform: null, status: "DRAFT", needsClientSignoff: false, tags: [], scheduledFor: null, generation: { engine: transcriber.name, origin: "transcription", sourceRef: durationSeconds ? `${durationSeconds}s` : null } }]);
  await repository.recordAutomationRun(tenant.id, { typeKey: "content_engine", outcome: "COMPLETED", summary: `Transcribed "${source.title ?? "a recording"}"${durationSeconds ? ` (${Math.round(durationSeconds / 60)} min)` : ""}.` });
  return { text, transcript };
}

/** The channels a tenant posts to: active connected channels, or the platforms named in the content module settings. */
export async function enabledPlatforms(tenantId: string, moduleSettings: Record<string, unknown>): Promise<SocialPlatform[]> {
  const channels = await repository.listChannels(tenantId, { activeOnly: true });
  const fromChannels = Array.from(new Set(channels.map((c) => c.platform)));
  if (fromChannels.length) return fromChannels;
  const configured = Array.isArray(moduleSettings.platforms) ? (moduleSettings.platforms as string[]) : [];
  return configured.filter((p): p is SocialPlatform => ["FACEBOOK", "INSTAGRAM", "TIKTOK", "YOUTUBE", "LINKEDIN", "GOOGLE_BUSINESS"].includes(p));
}

export interface GenerateResult {
  drafts: ContentAssetRecord[];
  skipped: string | null;
}

/**
 * One asset per enabled channel from a source, compliance-checked, footer
 * applied, waiting in review. Idempotent per source: platforms that already
 * have a draft from this source are not drafted again.
 */
export async function generateFromSource(tenant: TenantSummary, sourceId: string, opts: { platforms?: SocialPlatform[]; force?: boolean } = {}): Promise<GenerateResult> {
  const { enabled, moduleSettings, brand } = await engineSettings(tenant.id);
  if (!enabled) return { drafts: [], skipped: "The content engine is switched off for this workspace." };
  const source = await repository.findContentAssetById(tenant.id, sourceId);
  if (!source || !SOURCE_KINDS.includes(source.kind as (typeof SOURCE_KINDS)[number])) return { drafts: [], skipped: "That isn't source material." };

  const platforms = opts.platforms?.length ? opts.platforms : await enabledPlatforms(tenant.id, moduleSettings);
  if (platforms.length === 0) {
    await repository.recordAutomationRun(tenant.id, { typeKey: "content_engine", outcome: "SKIPPED", summary: `Nothing drafted from "${source.title ?? "new material"}": no channels are connected yet.` });
    return { drafts: [], skipped: "No channels are connected or chosen for this workspace." };
  }
  const existing = opts.force ? [] : await repository.listContentAssets(tenant.id, { parentId: source.id, limit: 50 });
  const todo = platforms.filter((p) => !existing.some((a) => a.targetPlatform === p && a.kind !== "TRANSCRIPT"));
  if (todo.length === 0) return { drafts: [], skipped: "Drafts for every channel already exist for this material." };

  const text = await sourceText(tenant, source);
  if (text.text === null) {
    await repository.recordAutomationRun(tenant.id, { typeKey: "content_engine", outcome: "SKIPPED", summary: `Couldn't draft from "${source.title ?? "new material"}": ${text.reason}` });
    return { drafts: [], skipped: text.reason };
  }

  const generator = getGenerator();
  const config = await repository.getTenantConfig(tenant.id);
  const services = tenant.qualificationRules.highIntentServices ?? [];
  const drafts = await generator.draft({ tenant, brand: config.brand ?? brand, source: { title: source.title, text: text.text, kind: source.kind }, platforms: todo, services });

  const created = await repository.createContentAssets(
    tenant.id,
    drafts.map((d) => {
      const spec = specFor(d.platform);
      const body = applyFooter(d.body, config.brand);
      const compliance = checkCompliance({ text: body, platform: d.platform, brand: config.brand, tenant });
      if (source.generation.origin === "review" && !compliance.issues.some((i) => i.code === "NAMED_PERSON")) {
        compliance.issues.push({ code: "NAMED_PERSON", message: "Built from a customer's review: the client confirms they're happy to quote them.", severity: "signoff" });
        compliance.needsClientSignoff = true;
      }
      return {
        kind: spec.kind,
        parentId: source.id,
        title: d.title,
        body,
        targetPlatform: d.platform,
        status: "IN_REVIEW" as const,
        needsClientSignoff: compliance.needsClientSignoff,
        tags: d.hashtags.map((h) => h.replace(/^#/, "")),
        scheduledFor: null,
        fileUrl: source.kind === "IMAGE" || source.kind === "RAW_VIDEO" ? source.fileUrl ?? null : null,
        generation: { engine: generator.name, model: generator.model, hashtags: d.hashtags, mediaBrief: d.mediaBrief, claims: d.claims, compliance, origin: source.generation.origin, sourceRef: source.id },
      };
    }),
  );

  const signoff = created.filter((a) => a.needsClientSignoff).length;
  const blocked = created.filter((a) => a.generation.compliance && !a.generation.compliance.ok).length;
  await repository.recordAutomationRun(tenant.id, {
    typeKey: "content_engine",
    outcome: "COMPLETED",
    summary: `Drafted ${created.length} post${created.length === 1 ? "" : "s"} from "${quoteUntrusted(source.title ?? "new material", 60)}" for ${todo.map((p) => specFor(p).label).join(", ")}${signoff ? `; ${signoff} need${signoff === 1 ? "s" : ""} your sign-off` : ""}${blocked ? `; ${blocked} need${blocked === 1 ? "s" : ""} a fix before approval` : ""}.`,
    details: { sourceId: source.id, engine: generator.name },
  });
  await emit(tenant.id, "content.drafted", { sourceId: source.id, assetIds: created.map((a) => a.id), engine: generator.name });
  return { drafts: created, skipped: null };
}

/**
 * Approval → the calendar. The asset gets the next free slot for its channel
 * (or the time the approver chose) and a SCHEDULED post is created. Without a
 * connected channel the post is still created, marked APPROVED, and shows in
 * the calendar as waiting for a channel.
 */
export async function scheduleApproved(tenant: TenantSummary, asset: ContentAssetRecord, opts: { at?: Date | null } = {}): Promise<{ post: Awaited<ReturnType<typeof repository.createSocialPosts>>[number] | null; when: Date | null }> {
  if (!asset.targetPlatform) return { post: null, when: null };
  const { moduleSettings } = await engineSettings(tenant.id);
  const existing = (await repository.listSocialPostsForAsset(tenant.id, asset.id)).filter((p) => p.status !== "FAILED");
  if (existing.length) return { post: existing[0], when: existing[0].scheduledFor };

  const channel = (await repository.listChannels(tenant.id, { activeOnly: true })).find((c) => c.platform === asset.targetPlatform) ?? null;
  const taken = (await repository.listSocialPosts(tenant.id, { status: ["SCHEDULED", "APPROVED", "PUBLISHING"], from: new Date(), limit: 500 })).filter((p) => p.platform === asset.targetPlatform).map((p) => p.scheduledFor!).filter(Boolean);
  const when = opts.at ?? asset.scheduledFor ?? nextFreeSlot(tenant, slotsFor(moduleSettings), taken);
  const spec = specFor(asset.targetPlatform);
  const caption = spec.kind === "YOUTUBE_META" || spec.kind === "SHORT_FORM_SCRIPT" ? asset.body ?? "" : asset.body ?? "";
  const item: NewSocialPost = { channelId: channel?.id ?? null, contentAssetId: asset.id, platform: asset.targetPlatform, caption, mediaUrls: asset.fileUrl ? [asset.fileUrl] : [], tags: asset.tags, status: channel ? "SCHEDULED" : "APPROVED", scheduledFor: when, batchId: asset.parentId ?? randomUUID() };
  const [post] = await repository.createSocialPosts(tenant.id, [item]);
  await repository.updateContentAsset(tenant.id, asset.id, { status: "SCHEDULED", scheduledFor: when });
  await repository.recordAutomationRun(tenant.id, { typeKey: "content_engine", outcome: "COMPLETED", summary: channel ? `Scheduled "${quoteUntrusted(asset.title ?? "a post", 60)}" for ${spec.label} on ${when.toLocaleString(tenant.locale, { timeZone: tenant.timezone, weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" })}.` : `Approved "${quoteUntrusted(asset.title ?? "a post", 60)}" for ${spec.label}; it will go out once that channel is connected.` });
  await emit(tenant.id, "content.scheduled", { assetId: asset.id, postId: post.id, platform: asset.targetPlatform, scheduledFor: when.toISOString(), hasChannel: Boolean(channel) });
  return { post, when };
}

/**
 * The daily batch for one tenant: draft from material nobody has used yet
 * (up to three pieces), then compare the next seven days with the cadence and
 * raise a calendar-gap exception when it falls short.
 */
export async function runContentBatch(tenant: TenantSummary, now = new Date()): Promise<{ drafted: number; gap: number }> {
  const { enabled, moduleSettings } = await engineSettings(tenant.id);
  if (!enabled) return { drafted: 0, gap: 0 };
  let drafted = 0;
  const sources = (await repository.listContentAssets(tenant.id, { kinds: ["RAW_TEXT", "RAW_AUDIO", "RAW_VIDEO", "IMAGE"], limit: 50 })).filter((s) => s.createdAt.getTime() > now.getTime() - 30 * 86_400_000);
  for (const source of sources.slice(0, 10)) {
    if (drafted >= 3) break;
    const children = await repository.listContentAssets(tenant.id, { parentId: source.id, limit: 1 });
    if (children.some((c) => c.kind !== "TRANSCRIPT")) continue;
    const result = await generateFromSource(tenant, source.id);
    if (result.drafts.length) drafted++;
  }
  const posts = await repository.listSocialPosts(tenant.id, { from: now, to: new Date(now.getTime() + 7 * 86_400_000), limit: 500 });
  const gap = calendarGap(posts, moduleSettings, now);
  if (gap.short > 0) {
    const waiting = await repository.listContentAssets(tenant.id, { status: ["IN_REVIEW"], limit: 50 });
    await repository.createException(tenant.id, {
      reason: `Only ${gap.scheduled} post${gap.scheduled === 1 ? "" : "s"} scheduled for the next 7 days at ${tenant.name}; the plan is ${gap.target}.`,
      suggestedAction: waiting.length ? `${waiting.length} draft${waiting.length === 1 ? " is" : "s are"} waiting for approval; approving them fills the week.` : "Add some source material (a voice note, a photo, a review) so the engine can draft.",
      confidence: 0.8,
    });
  }
  return { drafted, gap: gap.short };
}

let registered = false;

/** Event wiring: good reviews become source material and are drafted straight away. */
export function registerContentEngine() {
  if (registered) return;
  registered = true;
  subscribe("review.received", async (e) => {
    const tenant = await repository.findTenantById(e.tenantId);
    if (!tenant) return;
    const { enabled, settings } = await engineSettings(tenant.id);
    if (!enabled || settings.draftFromReviews === false) return;
    const minRating = typeof settings.minReviewRating === "number" ? settings.minReviewRating : 4;
    const rating = typeof e.payload.rating === "number" ? e.payload.rating : null;
    const review = (await repository.listReviews(tenant.id, { limit: 50 })).find((r) => r.id === e.payload.reviewId);
    if (!review || rating === null || rating < minRating || !review.body || review.body.trim().length < 40) return;
    const source = await ingestSource(tenant, { kind: "RAW_TEXT", title: `Review — ${review.authorName ?? "a customer"} (${review.provider}, ${rating} stars)`, body: review.body, origin: "review", sourceRef: review.id });
    await generateFromSource(tenant, source.id);
  });
}
