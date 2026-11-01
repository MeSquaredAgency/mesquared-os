import { ACTION_LEASE_MS, NonRetryableError, registerAutomations, runScheduledAction } from "@/lib/automations/handlers";
import { repository } from "@/lib/data";
import { weekBounds } from "@/lib/digest/weekly";
import { detectForTenant } from "@/lib/opportunities/detect";
import { registerPlaybook } from "@/lib/playbook";
import { registerContentEngine } from "@/lib/content/engine";
import { registerInventory } from "@/lib/inventory";
import { errorText, log } from "@/lib/log";
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
 * a day (after quiet hours end), the money, website and expiry jobs half an
 * hour later, one social sync an hour. The dedupe keys make this idempotent.
 */
async function scheduleRecurring(tenant: TenantSummary, now: Date) {
  const day = localKey(tenant.timezone, now);
  // Today's morning in the tenant's zone: the moment quiet hours end. Before it, the jobs wait for it; after it, they run now.
  const morning = quietHoursEnd(tenant, startOfDayInZone(tenant.timezone, now));
  const batchAt = morning > now ? morning : now;
  const dailyAt = new Date(batchAt.getTime() + 30 * 60_000);
  const hourBucket = now.toISOString().slice(0, 13);
  // Monday morning in the tenant's zone: the week's summary email, keyed by the week so a missed Monday still sends on Tuesday.
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tenant.timezone, weekday: "short" }).format(now);
  const { end: weekStart } = weekBounds(tenant.timezone, tenant.locale, now);
  const weekly = weekday === "Mon" || weekday === "Tue" ? [{ typeKey: "weekly_digest", action: "send", runAt: batchAt, dedupeKey: `digest:weekly:${localKey(tenant.timezone, weekStart)}` }] : [];
  const jobs = [
    ...weekly,
    { typeKey: "content_engine", action: "batch", runAt: batchAt, dedupeKey: `content:batch:${day}` },
    { typeKey: "ads_sync", action: "run", runAt: dailyAt, dedupeKey: `ads_sync:${day}` },
    { typeKey: "finance_sync", action: "run", runAt: dailyAt, dedupeKey: `finance_sync:${day}` },
    { typeKey: "website_analytics", action: "rollup", runAt: dailyAt, dedupeKey: `website_analytics:${day}` },
    { typeKey: "inventory_sync", action: "run", runAt: dailyAt, dedupeKey: `inventory_sync:${day}` },
    { typeKey: "sla_watch", action: "expire", runAt: dailyAt, dedupeKey: `sla_watch:expire:${day}` },
    { typeKey: "social_sync", action: "run", runAt: now, dedupeKey: `social:sync:${hourBucket}` },
  ];
  await Promise.all(
    jobs.map((job) =>
      repository.scheduleAction(tenant.id, { ...job, payload: {} }).catch((error) => {
        log("error", "tick.schedule_failed", { tenantId: tenant.id, typeKey: job.typeKey, action: job.action, error: errorText(error) });
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
      log("error", "tick.detectors_failed", { tenantId: tenant.id, tenant: tenant.slug, error: errorText(error) });
    }
    await scheduleRecurring(tenant, now);
  });
  if (skipped > 0) log("warn", "tick.detector_budget_spent", { skipped, tenants: tenants.length });

  const publishing = await publishDuePosts(now).catch((error) => {
    log("error", "tick.publishing_failed", { error: errorText(error) });
    return { published: 0, failed: 0, simulated: 0 };
  });

  let actionsRun = 0;
  let actionsFailed = 0;
  for (const action of await repository.listDueActions(now)) {
    if (Date.now() > deadline) {
      log("warn", "tick.action_budget_spent", { actionsRun, actionsFailed });
      break;
    }
    // Claim first so two overlapping ticks (or two instances) never run the same action.
    if (!(await repository.claimAction(action.id, now, ACTION_LEASE_MS))) continue;
    try {
      await runScheduledAction(action);
      await repository.completeAction(action.id, "DONE");
      actionsRun++;
    } catch (error) {
      const message = errorText(error);
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
      log("error", "tick.action_failed", { tenantId: action.tenantId, actionId: action.id, typeKey: action.typeKey, action: action.action, attempt, final, error: message });
      actionsFailed++;
    }
  }
  // The heartbeat is what the health endpoint and readiness read to know the scheduler is alive.
  await repository.recordHeartbeat("tick", new Date()).catch((error) => log("error", "tick.heartbeat_failed", { error: errorText(error) }));
  const result = { tenants: tenants.length, tenantsSkipped: skipped + tenantsFailed, detected, actionsRun, actionsFailed, published: publishing.published + publishing.simulated };
  log("info", "tick.done", { ...result, ms: Date.now() - started });
  return result;
}
