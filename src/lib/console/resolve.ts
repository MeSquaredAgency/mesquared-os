import { repository } from "@/lib/data";
import { emit } from "@/lib/events";
import type { ExceptionRecord } from "@/lib/types";

/** Closes one exception, settles its missed opportunity and logs the outcome. Returns null when it was already resolved. */
export async function settleException(tenantId: string, exceptionId: string, resolution: string, recovered: boolean, userId: string): Promise<ExceptionRecord | null> {
  const note = resolution.trim();
  const ex = await repository.resolveException(tenantId, exceptionId, note || "Resolved");
  if (!ex) return null;
  if (ex.missedOpportunityId) {
    const mo = recovered ? (await repository.listMissedOpportunities(tenantId, { limit: 500 })).find((m) => m.id === ex.missedOpportunityId) : undefined;
    await repository.resolveMissedOpportunity(tenantId, ex.missedOpportunityId, recovered ? "RECOVERED" : "EXPIRED", recovered ? (mo?.estimatedValueCents ?? 0) : 0);
  }
  await repository.recordAutomationRun(tenantId, {
    typeKey: "sla_watch",
    outcome: "COMPLETED",
    summary: recovered ? `Sorted by the Me² team: ${note || "handled"}.` : `Closed by the Me² team: ${note || "no longer relevant"}.`,
    leadId: ex.leadId,
    contactId: ex.contactId,
    missedOpportunityId: ex.missedOpportunityId,
  });
  await emit(tenantId, "exception.resolved", { exceptionId, by: userId, recovered });
  return ex;
}

export interface BulkCloseResult {
  closedIds: string[];
  alreadyResolved: number;
  outsidePortfolio: number;
}

/** Closes many exceptions at once without recovering them. Items in workspaces outside the caller's portfolio are skipped, never touched. */
export async function closeExceptionsInBulk(allowedTenantIds: ReadonlySet<string>, items: { tenantId: string; exceptionId: string }[], resolution: string, userId: string): Promise<BulkCloseResult> {
  const result: BulkCloseResult = { closedIds: [], alreadyResolved: 0, outsidePortfolio: 0 };
  const seen = new Set<string>();
  for (const item of items) {
    const key = `${item.tenantId}:${item.exceptionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!allowedTenantIds.has(item.tenantId)) {
      result.outsidePortfolio++;
      continue;
    }
    const ex = await settleException(item.tenantId, item.exceptionId, resolution, false, userId);
    if (ex) result.closedIds.push(item.exceptionId);
    else result.alreadyResolved++;
  }
  return result;
}
