import { ACTION_LEASE_MS, NonRetryableError, registerAutomations, runScheduledAction } from "@/lib/automations/handlers";
import { repository } from "@/lib/data";
import { detectForTenant } from "@/lib/opportunities/detect";
import { registerPlaybook } from "@/lib/playbook";
import { registerContentEngine } from "@/lib/content/engine";
import { registerInventory } from "@/lib/inventory";
import { quietHoursEnd } from "@/lib/messaging";
import { publishDuePosts } from "@/lib/social/publish";
import { localKey } from "@/lib/content/calendar";
import type { TenantSummary } from "@/lib/types";
import { startOfDayInZone } from "@/lib/utils";

/** Wall-clock budget for one tick; the cron runs every minute. Detectors get the first part of it, due actions the rest. */
const TICK_BUDGET_MS = Number.parseInt(process.env.TICK_BUDGET_MS ?? "50000", 10) || 50_000;
/** Share of the budget the detector phase may use before the tick moves on to due actions. */
const DETECTOR_BUDGET_SHARE = 0.6;
/** How many tenants' detectors run at once. */
const DETECTOR_CONCURRENCY = Number.parseInt(process.env.TICK_CONCURRENCY ?? "4", 10) || 4;
/** How many times a failing action is tried before it becomes an exception. */
export const MAX_ATTEMPTS = 3;

export interface TickResult {
  tenants: number;
  /** Tenants whose detectors did not run this tick: they failed, or the budget ran out first. */
  tenantsSkipped: number;
  detected: number;
  actionsRun: number;
  actionsFailed: number;
  published: number;
}

/**
 * When a failed action runs again: 5 minutes, then 10, then 20, with up to a
 * minute of jitter so a burst of failures does not come back as one burst.
 */
export function retryDelayMs(attempt: number, random = Math.random): number {
  const base = 5 * 60_000 * 2 ** Math.max(0, attempt - 1);
  return base + Math.floor(random() * 60_000);
}

/**
 * Recurring per-tenant work rides the same action queue: one content batch
 * a day (after quiet hours end), the money and website jobs half an hour
 * later, one social sync an hour. The dedupe keys make this idempotent.
 */
async function scheduleRecurring(tenant: TenantSummary, now: Date) {
  const day = localKey(tenant.timezone, now);
  // Today's morning in the tenant's zone: the moment quiet hours end. Before it, the jobs wait for it; after it, they run now.
  const morning = quietHoursEnd(tenant, startOfDayInZone(tenant.timezone, now));
  const batchAt = morning > now ? morning : now;
  const dailyAt = new Date(batchAt.getTime() + 30 * 60_000);
  const hourBucket = now.toISOString().slice(0, 13);
  const jobs = [
    { typeKey: "content_engine", action: "batch", runAt: batchAt, dedupeKey: `content:batch:${day}` },
    { typeKey: "ads_sync", action: "run", runAt: dailyAt, dedupeKey: `ads_sync:${day}` },
    { typeKey: "finance_sync", action: "run", runAt: dailyAt, dedupeKey: `finance_sync:${day}` },
    { typeKey: "website_analytics", action: "rollup", runAt: dailyAt, dedupeKey: `website_analytics:${day}` },
    { typeKey: "inventory_sync", action: "run", runAt: dailyAt, dedupeKey: `inventory_sync:${day}` },
    { typeKey: "social_sync", action: "run", runAt: now, dedupeKey: `social:sync:${hourBucket}` },
  ];
  await Promise.all(
    jobs.map((job) =>
      repository.scheduleAction(tenant.id, { ...job, payload: {} }).catch((error) => {
        console.error(`[jobs] could not queue ${job.typeKey} for ${tenant.slug}: ${error instanceof Error ? error.message : error}`);
      }),
    ),
  );
}

/** Runs `fn` over `items` with at most `limit` in flight, stopping (and reporting how many were left) once `deadline` passes. */
async function eachWithLimit<T>(items: T[], limit: number, deadline: number, fn: (item: T) => Promise<void>): Promise<{ skipped: number }> {
  let next = 0;
  let skipped = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      if (Date.now() > deadline) {
        skipped++;
        continue;
      }
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return { skipped };
}

/**
 * One scheduler tick: run the detectors for every active tenant, then
 * execute every scheduled action whose time has come. Safe to run every
 * minute; everything it touches is idempotent, and a tick that cannot finish
 * inside its minute stops taking on work and leaves the rest for the next.
 */
export async function tick(now = new Date()): Promise<TickResult> {
  registerPlaybook();
  registerAutomations();
  registerContentEngine();
  registerInventory();
  const started = Date.now();
  const deadline = started + TICK_BUDGET_MS;
  const detectorDeadline = started + TICK_BUDGET_MS * DETECTOR_BUDGET_SHARE;

  const tenants = await repository.listAllTenants();
  let detected = 0;
  let tenantsFailed = 0;
  const { skipped } = await eachWithLimit(tenants, DETECTOR_CONCURRENCY, detectorDeadline, async (tenant) => {
    try {
      detected += (await detectForTenant(tenant, now)).detected.length;
    } catch (error) {
      tenantsFailed++;
      console.error(`[jobs] detectors failed for ${tenant.slug}: ${error instanceof Error ? error.message : error}`);
    }
    await scheduleRecurring(tenant, now);
  });
  if (skipped > 0) console.warn(`[jobs] detector budget spent; ${skipped} tenant${skipped === 1 ? "" : "s"} left for the next tick`);

  const publishing = await publishDuePosts(now).catch((error) => {
    console.error(`[jobs] publishing failed: ${error instanceof Error ? error.message : error}`);
    return { published: 0, failed: 0, simulated: 0 };
  });

  let actionsRun = 0;
  let actionsFailed = 0;
  for (const action of await repository.listDueActions(now)) {
    if (Date.now() > deadline) {
      console.warn(`[jobs] tick budget spent; leaving remaining due actions for the next tick`);
      break;
    }
    // Claim first so two overlapping ticks (or two instances) never run the same action.
    if (!(await repository.claimAction(action.id, now, ACTION_LEASE_MS))) continue;
    try {
      await runScheduledAction(action);
      await repository.completeAction(action.id, "DONE");
      actionsRun++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const attempt = action.attempts + 1;
      const final = attempt >= MAX_ATTEMPTS || error instanceof NonRetryableError;
      if (final) {
        await repository.completeAction(action.id, "FAILED", message).catch(() => {});
        const leadId = typeof action.payload.leadId === "string" ? action.payload.leadId : null;
        const contactId = typeof action.payload.contactId === "string" ? action.payload.contactId : null;
        const tries = attempt === 1 ? "" : ` after ${attempt} tries`;
        await repository.recordAutomationRun(action.tenantId, { typeKey: action.typeKey, outcome: "FAILED", summary: `Couldn't finish "${action.action.replace(/_/g, " ")}"${tries}: ${message}`, leadId, contactId }).catch(() => {});
        await repository.createException(action.tenantId, { reason: `A scheduled step (${action.typeKey}: ${action.action.replace(/_/g, " ")}) failed${tries}: ${message}`, suggestedAction: "Check what the step was meant to send and do it by hand.", confidence: 0.8, leadId, contactId }).catch(() => {});
      } else await repository.completeAction(action.id, "PENDING", message, new Date(now.getTime() + retryDelayMs(attempt))).catch(() => {});
      console.error(`[jobs] action ${action.typeKey}:${action.action} failed (attempt ${attempt}${final ? ", final" : ""}): ${message}`);
      actionsFailed++;
    }
  }
  // The heartbeat is what the health endpoint and readiness read to know the scheduler is alive.
  await repository.recordHeartbeat("tick", new Date()).catch((error) => console.error(`[jobs] could not record the tick heartbeat: ${error instanceof Error ? error.message : error}`));
  return { tenants: tenants.length, tenantsSkipped: skipped + tenantsFailed, detected, actionsRun, actionsFailed, published: publishing.published + publishing.simulated };
}
