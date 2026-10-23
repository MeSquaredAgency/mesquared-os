"use server";

import { revalidatePath } from "next/cache";
import { getConsoleContext } from "@/lib/auth/access";
import { repository } from "@/lib/data";
import { emit } from "@/lib/events";

export interface ActionResult {
  ok: boolean;
  message: string;
}

/** Resolves an exception from the operator queue, optionally marking its missed opportunity recovered. */
export async function resolveException(tenantId: string, exceptionId: string, resolution: string, recovered: boolean): Promise<ActionResult> {
  const { tenants, user } = await getConsoleContext();
  if (!tenants.some((t) => t.tenant.id === tenantId)) return { ok: false, message: "That workspace isn’t in your portfolio." };
  const ex = await repository.resolveException(tenantId, exceptionId, resolution.trim() || "Resolved");
  if (!ex) return { ok: false, message: "That item was already resolved." };
  if (ex.missedOpportunityId) {
    const mo = (await repository.listMissedOpportunities(tenantId, { limit: 500 })).find((m) => m.id === ex.missedOpportunityId);
    await repository.resolveMissedOpportunity(tenantId, ex.missedOpportunityId, recovered ? "RECOVERED" : "EXPIRED", recovered ? (mo?.estimatedValueCents ?? 0) : 0);
  }
  await repository.recordAutomationRun(tenantId, {
    typeKey: "sla_watch",
    outcome: "COMPLETED",
    summary: recovered ? `An operator recovered this: ${resolution.trim() || "handled"}.` : `An operator closed this: ${resolution.trim() || "no longer relevant"}.`,
    leadId: ex.leadId,
    contactId: ex.contactId,
    missedOpportunityId: ex.missedOpportunityId,
  });
  await emit(tenantId, "exception.resolved", { exceptionId, by: user.id, recovered });
  revalidatePath("/console");
  return { ok: true, message: recovered ? "Marked recovered." : "Closed." };
}
