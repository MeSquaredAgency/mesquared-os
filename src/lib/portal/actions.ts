"use server";

import { revalidatePath } from "next/cache";
import { getPortalContext } from "@/lib/auth/access";
import { ForbiddenError, hasPermission } from "@/lib/auth/permissions";
import { repository } from "@/lib/data";
import { emit } from "@/lib/events";
import { leadDisplayName } from "@/lib/leads";
import { recoverOpportunities } from "@/lib/opportunities/reconcile";

export interface ActionResult {
  ok: boolean;
  message: string;
}

/**
 * "I've called them": a client person has dealt with a lead themselves. The
 * lead leaves "Needs you", its response clock stops so the detectors do not
 * raise it, and any open unanswered/never-booked item about it is recovered.
 * Members who see only their own records can only settle leads assigned to
 * them or to nobody.
 */
export async function markLeadHandled(tenantSlug: string, leadId: string): Promise<ActionResult> {
  try {
    const { access, user } = await getPortalContext(tenantSlug);
    const tenant = access.tenant;
    const lead = await repository.findLeadById(tenant.id, leadId);
    if (!lead) return { ok: false, message: "That lead no longer exists." };
    if (!hasPermission(access, "VIEW_ALL_RECORDS") && lead.assigneeId && lead.assigneeId !== user.id) throw new ForbiddenError("That lead is assigned to someone else.");
    const now = new Date();
    await repository.settleLeadSla(tenant.id, lead.id, now, { booking: true });
    // A person is talking to them now: out of "Needs you", not yet booked or won.
    if (lead.status === "NEW" || lead.status === "QUALIFIED" || lead.status === "BOOKING_SENT") await repository.setLeadStatus(tenant.id, lead.id, "NURTURING");
    const who = user.name?.trim().split(/\s+/)[0] || "You";
    await recoverOpportunities(tenant.id, { leadId: lead.id, types: ["UNANSWERED_ENQUIRY", "NOT_BOOKED"], because: `${who} spoke to ${leadDisplayName(lead)}` });
    await repository.recordAutomationRun(tenant.id, { typeKey: "sla_watch", outcome: "COMPLETED", summary: `${who} marked ${leadDisplayName(lead)} as called.`, leadId: lead.id, contactId: lead.contactId });
    await emit(tenant.id, "lead.handled", { leadId: lead.id, by: user.id, via: access.via });
    revalidatePath(`/app/${tenantSlug}`);
    revalidatePath(`/app/${tenantSlug}/leads`);
    revalidatePath(`/console/${tenantSlug}`);
    return { ok: true, message: `Noted. ${leadDisplayName(lead)} is off your list.` };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    console.error("[portal] markLeadHandled failed", error instanceof Error ? error.message : error);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}
