"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, ForbiddenError } from "@/lib/auth/roles";
import { repository } from "@/lib/data";
import { getCurrentTenant } from "@/lib/tenant/current";
import { SOCIAL_PLATFORMS, type ContentStatus, type MembershipRole, type SocialPlatform } from "@/lib/types";
import { zonedLocalToUtc } from "@/lib/utils";

export interface ActionResult {
  ok: boolean;
  message: string;
}

const CAN_DRAFT: MembershipRole[] = ["OWNER", "ADMIN", "OPERATOR", "MARKETING"];
const CAN_APPROVE: MembershipRole[] = ["OWNER", "ADMIN", "OPERATOR"];

const draftSchema = z.object({
  caption: z.string().trim().min(1, "Write something first.").max(10_000),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  platforms: z.array(z.enum(SOCIAL_PLATFORMS)).min(1, "Pick at least one channel."),
  /** Wall-clock time in the tenant's timezone, as typed into a datetime-local input. */
  scheduledForLocal: z.string().optional().nullable(),
});

const PLATFORM_TITLE: Record<SocialPlatform, string> = {
  FACEBOOK: "Facebook post",
  INSTAGRAM: "Instagram post",
  TIKTOK: "TikTok caption",
  YOUTUBE: "YouTube description",
  LINKEDIN: "LinkedIn post",
};

function failure(error: unknown): ActionResult {
  if (error instanceof ForbiddenError) return { ok: false, message: error.message };
  console.error("[marketing] action failed", error instanceof Error ? error.message : error);
  return { ok: false, message: "Something went wrong. Please try again." };
}

/**
 * Turns one draft into a review item per selected channel. Lives on the
 * server so the tenant and role come from the session, never from the client.
 */
export async function submitDraft(input: unknown): Promise<ActionResult> {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the draft and try again." };

  try {
    const { tenant } = await getCurrentTenant();
    requireRole(tenant.role, CAN_DRAFT);

    const { caption, tags, platforms, scheduledForLocal } = parsed.data;
    const scheduledFor = scheduledForLocal ? zonedLocalToUtc(scheduledForLocal, tenant.timezone) : null;
    const firstLine = caption.split("\n")[0].slice(0, 60);

    await repository.createContentAssets(
      tenant.id,
      platforms.map((platform) => ({
        kind: "POST_COPY",
        title: `${PLATFORM_TITLE[platform]} — ${firstLine}`,
        body: caption,
        targetPlatform: platform,
        status: "IN_REVIEW",
        tags,
        scheduledFor,
      })),
    );
    revalidatePath("/marketing");
    return { ok: true, message: `${platforms.length} draft${platforms.length === 1 ? "" : "s"} sent to review.` };
  } catch (error) {
    return failure(error);
  }
}

const DECISIONS: ContentStatus[] = ["APPROVED", "REJECTED", "IN_REVIEW"];

export async function decideAsset(assetId: string, status: ContentStatus): Promise<ActionResult> {
  if (!DECISIONS.includes(status)) return { ok: false, message: "Unsupported decision." };
  try {
    const { tenant } = await getCurrentTenant();
    requireRole(tenant.role, CAN_APPROVE);
    const updated = await repository.updateContentAssetStatus(tenant.id, assetId, status);
    if (!updated) return { ok: false, message: "That draft no longer exists." };
    revalidatePath("/marketing");
    return {
      ok: true,
      message: status === "APPROVED" ? "Approved and queued for scheduling." : status === "REJECTED" ? "Rejected — sent back to the engine." : "Moved back to review.",
    };
  } catch (error) {
    return failure(error);
  }
}
