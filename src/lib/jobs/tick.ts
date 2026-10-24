import { registerAutomations, runScheduledAction } from "@/lib/automations/handlers";
import { repository } from "@/lib/data";
import { detectForTenant } from "@/lib/opportunities/detect";
import { registerPlaybook } from "@/lib/playbook";

export interface TickResult {
  tenants: number;
  detected: number;
  actionsRun: number;
  actionsFailed: number;
}

/**
 * One scheduler tick: run the detectors for every active tenant, then
 * execute every scheduled action whose time has come. Safe to run every
 * minute; everything it touches is idempotent.
 */
export async function tick(now = new Date()): Promise<TickResult> {
  registerPlaybook();
  registerAutomations();
  const tenants = await repository.listAllTenants();
  let detected = 0;
  for (const tenant of tenants) {
    try {
      detected += (await detectForTenant(tenant, now)).detected.length;
    } catch (error) {
      console.error(`[jobs] detectors failed for ${tenant.slug}: ${error instanceof Error ? error.message : error}`);
    }
  }

  let actionsRun = 0;
  let actionsFailed = 0;
  for (const action of await repository.listDueActions(now)) {
    try {
      await runScheduledAction(action);
      await repository.completeAction(action.id, "DONE");
      actionsRun++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await repository.completeAction(action.id, action.attempts >= 2 ? "FAILED" : "PENDING" as never, message).catch(() => {});
      console.error(`[jobs] action ${action.typeKey}:${action.action} failed: ${message}`);
      actionsFailed++;
    }
  }
  return { tenants: tenants.length, detected, actionsRun, actionsFailed };
}
