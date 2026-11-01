import { repository } from "@/lib/data";
import { emit } from "@/lib/events";
import { MISSED_OPPORTUNITY_LABEL } from "@/lib/copy";
import { log } from "@/lib/log";
import type { TenantSummary } from "@/lib/types";

/** Default age after which an open item is written off; the `sla_watch` setting `expireAfterDays` overrides it, 0 turns the sweep off. */
export const DEFAULT_EXPIRE_AFTER_DAYS = 30;

/**
 * The daily sweep. An enquiry nobody reached in a month is not coming back,
 * and leaving it in "money at risk" makes that number a lie and the queue a
 * museum. Each stale item is closed as EXPIRED (its exception with it) and
 * the client sees one honest line: "Closed 3 items older than 30 days."
 */
export async function expireStaleOpportunities(tenant: TenantSummary, now = new Date()): Promise<{ expired: number; valueCents: number }> {
  const config = await repository.getTenantConfig(tenant.id);
  const watch = config.automations.find((a) => a.typeKey === "sla_watch");
  const days = typeof watch?.settings.expireAfterDays === "number" ? watch.settings.expireAfterDays : DEFAULT_EXPIRE_AFTER_DAYS;
  if (!watch?.enabled || days <= 0) return { expired: 0, valueCents: 0 };

  const stale = await repository.listOpenMissedOpportunitiesBefore(tenant.id, new Date(now.getTime() - days * 86_400_000));
  let valueCents = 0;
  const kinds = new Map<string, number>();
  for (const item of stale) {
    const closed = await repository.resolveMissedOpportunity(tenant.id, item.id, "EXPIRED", 0);
    if (!closed) continue;
    valueCents += item.estimatedValueCents;
    const label = MISSED_OPPORTUNITY_LABEL[item.type] ?? item.type;
    kinds.set(label, (kinds.get(label) ?? 0) + 1);
    await emit(tenant.id, "missed_opportunity.expired", { missedOpportunityId: item.id, type: item.type, ageDays: Math.floor((now.getTime() - item.detectedAt.getTime()) / 86_400_000) });
  }
  const expired = [...kinds.values()].reduce((a, b) => a + b, 0);
  if (expired > 0) {
    const breakdown = [...kinds.entries()].map(([label, n]) => `${n} ${label.toLowerCase()}${n === 1 ? "" : "s"}`).join(", ");
    await repository.recordAutomationRun(tenant.id, { typeKey: "sla_watch", outcome: "SKIPPED", summary: `Closed ${expired} item${expired === 1 ? "" : "s"} older than ${days} days that nobody could recover (${breakdown}).` });
    log("info", "opportunities.expired", { tenantId: tenant.id, expired, valueCents, days });
  }
  return { expired, valueCents };
}
