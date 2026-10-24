"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getConsoleContext, getPortalContext } from "@/lib/auth/access";
import { ForbiddenError, requirePermission } from "@/lib/auth/permissions";
import { repository } from "@/lib/data";
import { emit } from "@/lib/events";
import { saveChannelCredentials } from "@/lib/social/credentials";
import { replyToConversation } from "@/lib/social/inbox";
import { publishPost } from "@/lib/social/publish";
import { syncChannelMetrics } from "@/lib/social/metrics";
import { runSocialSync } from "@/lib/social/sync";
import type { ContentStatus, SocialPlatform, TenantSummary } from "@/lib/types";
import { checkCompliance } from "./compliance";
import { generateFromSource, ingestSource, scheduleApproved } from "./engine";

export interface ActionResult {
  ok: boolean;
  message: string;
}

const PLATFORMS = ["FACEBOOK", "INSTAGRAM", "TIKTOK", "YOUTUBE", "LINKEDIN", "GOOGLE_BUSINESS"] as const;

/** Resolves the tenant from the operator's portfolio, never from the client. */
async function operatorTenant(tenantId: string): Promise<{ tenant: TenantSummary; userId: string } | null> {
  const { tenants, user } = await getConsoleContext();
  const access = tenants.find((t) => t.tenant.id === tenantId);
  return access ? { tenant: access.tenant, userId: user.id } : null;
}

const refresh = (tenant: TenantSummary) => {
  revalidatePath(`/console/${tenant.slug}`);
  revalidatePath(`/app/${tenant.slug}`);
  revalidatePath(`/app/${tenant.slug}/content`);
};

const fail = (error: unknown): ActionResult => {
  if (error instanceof ForbiddenError) return { ok: false, message: error.message };
  console.error("[content] action failed", error instanceof Error ? error.message : error);
  return { ok: false, message: "Something went wrong. Please try again." };
};

const sourceSchema = z.object({ title: z.string().trim().min(2).max(200), body: z.string().trim().min(20).max(20_000), generate: z.boolean().default(true) });

/** Operator pastes material (notes, a transcript, a review) and the engine drafts from it. */
export async function createSourceAction(tenantId: string, input: { title: string; body: string; generate: boolean }): Promise<ActionResult & { sourceId?: string }> {
  try {
    const ctx = await operatorTenant(tenantId);
    if (!ctx) return { ok: false, message: "That workspace isn’t in your portfolio." };
    const parsed = sourceSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "Give the material a short title and at least a couple of sentences." };
    const source = await ingestSource(ctx.tenant, { kind: "RAW_TEXT", title: parsed.data.title, body: parsed.data.body, origin: "operator" });
    let message = "Material saved.";
    if (parsed.data.generate) {
      const result = await generateFromSource(ctx.tenant, source.id);
      message = result.skipped ?? `Drafted ${result.drafts.length} post${result.drafts.length === 1 ? "" : "s"}; they’re waiting in review.`;
    }
    refresh(ctx.tenant);
    return { ok: true, message, sourceId: source.id };
  } catch (error) {
    return fail(error);
  }
}

export async function generateDraftsAction(tenantId: string, sourceId: string, force = false): Promise<ActionResult> {
  try {
    const ctx = await operatorTenant(tenantId);
    if (!ctx) return { ok: false, message: "That workspace isn’t in your portfolio." };
    const result = await generateFromSource(ctx.tenant, sourceId, { force });
    refresh(ctx.tenant);
    return { ok: !result.skipped || result.drafts.length > 0, message: result.skipped ?? `Drafted ${result.drafts.length} post${result.drafts.length === 1 ? "" : "s"}.` };
  } catch (error) {
    return fail(error);
  }
}

const draftSchema = z.object({ title: z.string().trim().min(2).max(200), body: z.string().trim().min(1).max(5000) });

/** Edits a draft and re-runs the brand and compliance checks on the new text. */
export async function updateDraftAction(tenantId: string, assetId: string, input: { title: string; body: string }): Promise<ActionResult> {
  try {
    const ctx = await operatorTenant(tenantId);
    if (!ctx) return { ok: false, message: "That workspace isn’t in your portfolio." };
    const parsed = draftSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "A draft needs a title and some text." };
    const asset = await repository.findContentAssetById(tenantId, assetId);
    if (!asset) return { ok: false, message: "That draft no longer exists." };
    if (asset.status === "PUBLISHED") return { ok: false, message: "That one has already gone out." };
    const config = await repository.getTenantConfig(tenantId);
    const compliance = checkCompliance({ text: parsed.data.body, platform: asset.targetPlatform, brand: config.brand, tenant: ctx.tenant });
    await repository.updateContentAsset(tenantId, assetId, { title: parsed.data.title, body: parsed.data.body, needsClientSignoff: compliance.needsClientSignoff, generation: { ...asset.generation, compliance, editedBy: "operator" } as typeof asset.generation, ...(asset.status === "REJECTED" ? { status: "IN_REVIEW" as const, rejectionNote: null } : {}) });
    refresh(ctx.tenant);
    return { ok: true, message: compliance.ok ? (compliance.needsClientSignoff ? "Saved. It needs the client’s sign-off." : "Saved and passing the checks.") : `Saved, but fix before approving: ${compliance.issues.filter((i) => i.severity === "block").map((i) => i.message).join(" ")}` };
  } catch (error) {
    return fail(error);
  }
}

const DECISIONS: ContentStatus[] = ["APPROVED", "REJECTED", "IN_REVIEW"];

/**
 * Approve or send back from the console. Blocked drafts cannot be approved;
 * drafts flagged for the client wait for a tenant member. Approval puts the
 * asset on the calendar.
 */
export async function decideDraftAction(tenantId: string, assetId: string, status: ContentStatus, opts: { note?: string; at?: string | null } = {}): Promise<ActionResult> {
  if (!DECISIONS.includes(status)) return { ok: false, message: "Unsupported decision." };
  try {
    const ctx = await operatorTenant(tenantId);
    if (!ctx) return { ok: false, message: "That workspace isn’t in your portfolio." };
    const asset = await repository.findContentAssetById(tenantId, assetId);
    if (!asset) return { ok: false, message: "That draft no longer exists." };
    if (status === "APPROVED") {
      if (asset.generation.compliance && !asset.generation.compliance.ok) return { ok: false, message: "Fix the flagged issues before approving." };
      if (asset.needsClientSignoff) return { ok: false, message: "This one mentions prices, names or claims and needs the client’s own sign-off." };
      const at = opts.at ? new Date(opts.at) : null;
      if (at && Number.isNaN(at.getTime())) return { ok: false, message: "That date doesn’t look right." };
      await repository.updateContentAssetStatus(tenantId, assetId, "APPROVED");
      await emit(tenantId, "content.approved", { assetId, by: ctx.userId, via: "operator" });
      const { when, post } = await scheduleApproved(ctx.tenant, { ...asset, status: "APPROVED" }, { at });
      refresh(ctx.tenant);
      return { ok: true, message: post?.status === "SCHEDULED" && when ? `Approved and scheduled for ${when.toLocaleString(ctx.tenant.locale, { timeZone: ctx.tenant.timezone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}.` : "Approved; it goes out once the channel is connected." };
    }
    await repository.updateContentAssetStatus(tenantId, assetId, status, opts.note?.trim().slice(0, 500) || null);
    await emit(tenantId, `content.${status.toLowerCase()}`, { assetId, by: ctx.userId, via: "operator" });
    refresh(ctx.tenant);
    return { ok: true, message: status === "REJECTED" ? "Sent back with your note." : "Moved back to review." };
  } catch (error) {
    return fail(error);
  }
}

export async function reschedulePostAction(tenantId: string, postId: string, atIso: string): Promise<ActionResult> {
  try {
    const ctx = await operatorTenant(tenantId);
    if (!ctx) return { ok: false, message: "That workspace isn’t in your portfolio." };
    const at = new Date(atIso);
    if (Number.isNaN(at.getTime())) return { ok: false, message: "That date doesn’t look right." };
    const post = await repository.findSocialPostById(tenantId, postId);
    if (!post) return { ok: false, message: "That post no longer exists." };
    if (post.status === "PUBLISHED" || post.status === "PUBLISHING") return { ok: false, message: "That post is already on its way." };
    await repository.updateSocialPost(tenantId, postId, { scheduledFor: at, status: post.channelId ? "SCHEDULED" : "APPROVED", errorMessage: null });
    if (post.contentAssetId) await repository.updateContentAsset(tenantId, post.contentAssetId, { scheduledFor: at });
    refresh(ctx.tenant);
    return { ok: true, message: "Moved." };
  } catch (error) {
    return fail(error);
  }
}

export async function publishNowAction(tenantId: string, postId: string): Promise<ActionResult> {
  try {
    const ctx = await operatorTenant(tenantId);
    if (!ctx) return { ok: false, message: "That workspace isn’t in your portfolio." };
    const result = await publishPost(ctx.tenant, postId);
    refresh(ctx.tenant);
    return result;
  } catch (error) {
    return fail(error);
  }
}

export async function cancelPostAction(tenantId: string, postId: string): Promise<ActionResult> {
  try {
    const ctx = await operatorTenant(tenantId);
    if (!ctx) return { ok: false, message: "That workspace isn’t in your portfolio." };
    const post = await repository.findSocialPostById(tenantId, postId);
    if (!post) return { ok: false, message: "That post no longer exists." };
    if (post.status === "PUBLISHED" || post.status === "PUBLISHING") return { ok: false, message: "That post is already on its way." };
    await repository.updateSocialPost(tenantId, postId, { status: "DRAFT", scheduledFor: null });
    if (post.contentAssetId) await repository.updateContentAsset(tenantId, post.contentAssetId, { status: "APPROVED", scheduledFor: null });
    refresh(ctx.tenant);
    return { ok: true, message: "Taken off the calendar; the draft stays approved." };
  } catch (error) {
    return fail(error);
  }
}

export async function replyInboxAction(tenantId: string, conversationId: string, text: string): Promise<ActionResult> {
  try {
    const ctx = await operatorTenant(tenantId);
    if (!ctx) return { ok: false, message: "That workspace isn’t in your portfolio." };
    const result = await replyToConversation(ctx.tenant, conversationId, text, "OPERATOR");
    refresh(ctx.tenant);
    return result;
  } catch (error) {
    return fail(error);
  }
}

export async function markInboxHandledAction(tenantId: string, conversationId: string): Promise<ActionResult> {
  try {
    const ctx = await operatorTenant(tenantId);
    if (!ctx) return { ok: false, message: "That workspace isn’t in your portfolio." };
    await repository.updateConversation(tenantId, conversationId, { awaitingReply: false, suggestedReply: null });
    const convo = await repository.findConversationById(tenantId, conversationId);
    if (convo) await repository.resolveMissedOpportunityByKey(tenantId, `${convo.channel === "SOCIAL_DM" ? "UNREPLIED_DM" : "UNREPLIED_COMMENT"}:${convo.id}`, "RECOVERED");
    refresh(ctx.tenant);
    return { ok: true, message: "Marked as handled." };
  } catch (error) {
    return fail(error);
  }
}

/** Portal: a tenant member with APPROVE_CONTENT replies publicly as the business. */
export async function portalReplyAction(tenantSlug: string, conversationId: string, text: string): Promise<ActionResult> {
  try {
    const { access } = await getPortalContext(tenantSlug);
    requirePermission(access, "APPROVE_CONTENT");
    const result = await replyToConversation(access.tenant, conversationId, text, "CLIENT_STAFF");
    revalidatePath(`/app/${tenantSlug}/content`);
    return result;
  } catch (error) {
    return fail(error);
  }
}

const connectSchema = z.object({
  platform: z.enum(PLATFORMS),
  externalAccountId: z.string().trim().min(1).max(200),
  displayName: z.string().trim().max(120).optional(),
  accessToken: z.string().trim().min(8).max(4000),
  refreshToken: z.string().trim().max(4000).optional(),
  igUserId: z.string().trim().max(100).optional(),
});

/**
 * Connects a channel from the console: the operator pastes the account id
 * and a token obtained through the platform's own developer flow. The token is
 * encrypted on the tenant's integration row; it is never echoed back.
 */
export async function connectChannelAction(tenantId: string, input: z.input<typeof connectSchema>): Promise<ActionResult> {
  try {
    const ctx = await operatorTenant(tenantId);
    if (!ctx) return { ok: false, message: "That workspace isn’t in your portfolio." };
    const parsed = connectSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "Platform, account id and an access token are needed." };
    const d = parsed.data;
    const platform = d.platform as SocialPlatform;
    await saveChannelCredentials(tenantId, platform, { accessToken: d.accessToken, refreshToken: d.refreshToken || null }, { externalAccountId: d.externalAccountId, label: d.displayName || null });
    const integration = await repository.findIntegration(tenantId, platform === "INSTAGRAM" || platform === "FACEBOOK" ? "META" : platform);
    await repository.upsertChannel(tenantId, { platform, externalAccountId: d.externalAccountId, displayName: d.displayName || null, integrationId: integration?.id ?? null, settings: d.igUserId ? { igUserId: d.igUserId } : {} });
    await repository.recordAutomationRun(tenantId, { typeKey: "social_sync", outcome: "COMPLETED", summary: `Connected ${d.displayName || d.externalAccountId} on ${platform.replace("_", " ").toLowerCase()}.` });
    refresh(ctx.tenant);
    return { ok: true, message: "Channel connected. The next sync will pull its inbox and numbers." };
  } catch (error) {
    return fail(error);
  }
}

export async function syncNowAction(tenantId: string): Promise<ActionResult> {
  try {
    const ctx = await operatorTenant(tenantId);
    if (!ctx) return { ok: false, message: "That workspace isn’t in your portfolio." };
    const [sync, metrics] = await Promise.all([runSocialSync(ctx.tenant), syncChannelMetrics(ctx.tenant)]);
    refresh(ctx.tenant);
    return { ok: true, message: `Synced: ${sync.inbox} new in the inbox, ${sync.reviews} new reviews, numbers for ${metrics.recorded} channel${metrics.recorded === 1 ? "" : "s"}.` };
  } catch (error) {
    return fail(error);
  }
}
