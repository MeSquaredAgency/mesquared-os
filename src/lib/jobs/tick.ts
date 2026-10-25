import { ACTION_LEASE_MS, registerAutomations, runScheduledAction } from "@/lib/automations/handlers";
import { repository } from "@/lib/data";
import { detectForTenant } from "@/lib/opportunities/detect";
import { registerPlaybook } from "@/lib/playbook";
import { registerContentEngine } from "@/lib/content/engine";
import { registerInventory } from "@/lib/inventory";
import { quietHoursEnd } from "@/lib/messaging";
import { publishDuePosts } from "@/lib/social/publish";
import { localKey } from "@/lib/content/calendar";
import { startOfDayInZone } from "@/lib/utils";

/** Wall-clock budget for one tick's action loop; the cron runs every minute. */
const TICK_BUDGET_MS = Number.parseInt(process.env.TICK_BUDGET_MS ?? "50000", 10) || 50_000;

export interface TickResult {
  tenants: number;
  detected: number;
  actionsRun: number;
  actionsFailed: number;
  published: number;
}

/**
 * One scheduler tick: run the detectors for every active tenant, then
 * execute every scheduled action whose time has come. Safe to run every
 * minute; everything it touches is idempotent.
 */
export async function tick(now = new Date()): Promise<TickResult> {
  registerPlaybook();
  registerAutomations();
  registerContentEngine();
  registerInventory();
  const tenants = await repository.listAllTenants();
  let detected = 0;
  for (const tenant of tenants) {
    try {
      detected += (await detectForTenant(tenant, now)).detected.length;
    } catch (error) {
      console.error(`[jobs] detectors failed for ${tenant.slug}: ${error instanceof Error ? error.message : error}`);
    }
    // Recurring per-tenant work rides the same queue: one content batch a day (after quiet hours end), one social sync an hour.
    const day = localKey(tenant.timezone, now);
    // Today's morning in the tenant's zone: the moment quiet hours end. Before it, the jobs wait for it; after it, they run now.
    const morning = quietHoursEnd(tenant, startOfDayInZone(tenant.timezone, now));
    const batchAt = morning > now ? morning : now;
    await repository.scheduleAction(tenant.id, { typeKey: "content_engine", action: "batch", runAt: batchAt, payload: {}, dedupeKey: `content:batch:${day}` }).catch(() => {});
    // Daily money and website jobs, half an hour after the content batch.
    const dailyAt = new Date(batchAt.getTime() + 30 * 60_000);
    for (const [typeKey, action] of [["ads_sync", "run"], ["finance_sync", "run"], ["website_analytics", "rollup"], ["inventory_sync", "run"]] as const) {
      await repository.scheduleAction(tenant.id, { typeKey, action, runAt: dailyAt, payload: {}, dedupeKey: `${typeKey}:${day}` }).catch(() => {});
    }
    const hourBucket = now.toISOString().slice(0, 13);
    await repository.scheduleAction(tenant.id, { typeKey: "social_sync", action: "run", runAt: now, payload: {}, dedupeKey: `social:sync:${hourBucket}` }).catch(() => {});
  }

  const publishing = await publishDuePosts(now).catch((error) => {
    console.error(`[jobs] publishing failed: ${error instanceof Error ? error.message : error}`);
    return { published: 0, failed: 0, simulated: 0 };
  });

  let actionsRun = 0;
  let actionsFailed = 0;
  // A tick that cannot finish inside its minute stops taking on new actions; what is left is still due next minute.
  const deadline = Date.now() + TICK_BUDGET_MS;
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
      if (attempt >= 3) {
        await repository.completeAction(action.id, "FAILED", message).catch(() => {});
        const leadId = typeof action.payload.leadId === "string" ? action.payload.leadId : null;
        const contactId = typeof action.payload.contactId === "string" ? action.payload.contactId : null;
        await repository.recordAutomationRun(action.tenantId, { typeKey: action.typeKey, outcome: "FAILED", summary: `Couldn't finish "${action.action.replace(/_/g, " ")}" after 3 tries: ${message}`, leadId, contactId }).catch(() => {});
        await repository.createException(action.tenantId, { reason: `A scheduled step (${action.typeKey}: ${action.action.replace(/_/g, " ")}) failed 3 times: ${message}`, suggestedAction: "Check what the step was meant to send and do it by hand.", confidence: 0.8, leadId, contactId }).catch(() => {});
      } else await repository.completeAction(action.id, "PENDING", message, new Date(now.getTime() + attempt * 5 * 60_000)).catch(() => {});
      console.error(`[jobs] action ${action.typeKey}:${action.action} failed (attempt ${attempt}): ${message}`);
      actionsFailed++;
    }
  }
  // The heartbeat is what the health endpoint and readiness read to know the scheduler is alive.
  await repository.recordHeartbeat("tick", new Date()).catch((error) => console.error(`[jobs] could not record the tick heartbeat: ${error instanceof Error ? error.message : error}`));
  return { tenants: tenants.length, detected, actionsRun, actionsFailed, published: publishing.published + publishing.simulated };
}
