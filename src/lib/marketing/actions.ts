"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError, requirePermission } from "@/lib/auth/permissions";
import { getPortalContext } from "@/lib/auth/access";
import { repository } from "@/lib/data";
import { emit } from "@/lib/events";
import type { ContentStatus } from "@/lib/types";

export interface ActionResult {
  ok: boolean;
  message: string;
}

const DECISIONS: ContentStatus[] = ["APPROVED", "REJECTED", "IN_REVIEW"];

/**
 * Approve or reject a content asset. The tenant and permission come from
 * the session and the URL, never from the client. Assets that need client
 * sign-off can only be approved by a tenant member with APPROVE_CONTENT;
 * operators approve the routine ones.
 */
export async function decideAsset(tenantSlug: string, assetId: string, status: ContentStatus): Promise<ActionResult> {
  if (!DECISIONS.includes(status)) return { ok: false, message: "Unsupported decision." };
  try {
    const { access, user } = await getPortalContext(tenantSlug);
    requirePermission(access, "APPROVE_CONTENT");
    const current = (await repository.getWorkbench(access.tenant.id)).assets.find((a) => a.id === assetId);
    if (!current) return { ok: false, message: "That draft no longer exists." };
    if (current.needsClientSignoff && status === "APPROVED" && access.via !== "member") {
      return { ok: false, message: "This one mentions prices, names or claims and needs the client's own sign-off." };
    }
    const updated = await repository.updateContentAssetStatus(access.tenant.id, assetId, status);
    if (!updated) return { ok: false, message: "That draft no longer exists." };
    await emit(access.tenant.id, `content.${status.toLowerCase()}`, { assetId, by: user.id, via: access.via });
    revalidatePath(`/app/${tenantSlug}`);
    return { ok: true, message: status === "APPROVED" ? "Approved and queued for scheduling." : status === "REJECTED" ? "Sent back to the engine." : "Moved back to review." };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    console.error("[content] decision failed", error instanceof Error ? error.message : error);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}
