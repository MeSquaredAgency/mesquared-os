import { repository } from "@/lib/data";
import { emit } from "@/lib/events";
import type { ExceptionRecord, MissedOpportunityType } from "@/lib/types";

/** Opportunity types whose subject is a lead's SLA clock: settling them must stop that clock, or the detector raises the same lead again a week later. */
const SLA_TYPES: ReadonlySet<MissedOpportunityType> = new Set<MissedOpportunityType>(["UNANSWERED_ENQUIRY", "NOT_BOOKED"]);

/** Closes one exception, settles its missed opportunity and logs the outcome. Returns null when it was already resolved. */
export async function settleException(tenantId: string, exceptionId: string, resolution: string, recovered: boolean, userId: string): Promise<ExceptionRecord | null> {
  const note = resolution.trim();
  const ex = await repository.resolveException(tenantId, exceptionId, note || "Resolved");
  if (!ex) return null;
  const now = new Date();
  if (ex.missedOpportunityId) {
    const mo = await repository.findMissedOpportunityById(tenantId, ex.missedOpportunityId);
    await repository.resolveMissedOpportunity(tenantId, ex.missedOpportunityId, recovered ? "RECOVERED" : "EXPIRED", recovered ? (mo?.estimatedValueCents ?? 0) : 0);
    // A person has dealt with this lead: the enquiry counts as answered, and a closed booking item stops the booking clock.
    if (mo && SLA_TYPES.has(mo.type) && mo.leadId) await repository.settleLeadSla(tenantId, mo.leadId, now, { booking: mo.type === "NOT_BOOKED" });
  } else if (ex.leadId) {
    await repository.settleLeadSla(tenantId, ex.leadId, now);
  }
  await repository.recordAutomationRun(tenantId, {
    typeKey: "sla_watch",
    // A write-off is logged but is not work done for the client, so it never counts as handled.
    outcome: recovered ? "COMPLETED" : "SKIPPED",
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
