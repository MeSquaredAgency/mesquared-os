"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getConsoleContext } from "@/lib/auth/access";
import { repository } from "@/lib/data";
import { emit } from "@/lib/events";

export interface ActionResult {
  ok: boolean;
  message: string;
}

/** Resolves an exception from the operator queue, optionally marking its missed opportunity recovered. */
const resolutionSchema = z.string().trim().max(500);
const requestSchema = z.object({ kind: z.string().trim().min(1).max(40), description: z.string().trim().min(1).max(200), dueInDays: z.number().int().min(1).max(60).nullable() });

export async function resolveException(tenantId: string, exceptionId: string, resolution: string, recovered: boolean): Promise<ActionResult> {
  resolution = resolutionSchema.parse(resolution ?? "");
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
    summary: recovered ? `Sorted by the Me² team: ${resolution.trim() || "handled"}.` : `Closed by the Me² team: ${resolution.trim() || "no longer relevant"}.`,
    leadId: ex.leadId,
    contactId: ex.contactId,
    missedOpportunityId: ex.missedOpportunityId,
  });
  await emit(tenantId, "exception.resolved", { exceptionId, by: user.id, recovered });
  revalidatePath("/console");
  return { ok: true, message: recovered ? "Marked recovered." : "Closed." };
}

/** Operator marks how an appointment went. Completed triggers the follow-up and review automations; no-show raises a missed opportunity. */
export async function setBookingOutcome(tenantId: string, bookingId: string, outcome: "COMPLETED" | "NO_SHOW" | "CANCELLED"): Promise<ActionResult> {
  const { tenants } = await getConsoleContext();
  if (!tenants.some((t) => t.tenant.id === tenantId)) return { ok: false, message: "That workspace isn’t in your portfolio." };
  const { registerAutomations } = await import("@/lib/automations/handlers");
  registerAutomations();
  const booking = await repository.updateBooking(tenantId, bookingId, { status: outcome });
  if (!booking) return { ok: false, message: "Booking not found." };
  await repository.cancelActions(tenantId, `booking:${booking.id}:`);
  await emit(tenantId, outcome === "COMPLETED" ? "booking.completed" : outcome === "NO_SHOW" ? "booking.no_show" : "booking.cancelled", { bookingId: booking.id, leadId: booking.leadId, by: "operator" });
  revalidatePath("/console");
  return { ok: true, message: outcome === "COMPLETED" ? "Marked completed. Follow-up and review request are queued." : outcome === "NO_SHOW" ? "Marked as a no-show." : "Cancelled." };
}

/** Opens a request for a document or information; the chase automation takes it from there. */
export async function openRequest(tenantId: string, input: { contactId: string | null; leadId: string | null; kind: string; description: string; dueInDays: number | null }): Promise<ActionResult> {
  const { tenants } = await getConsoleContext();
  const access = tenants.find((t) => t.tenant.id === tenantId);
  if (!access) return { ok: false, message: "That workspace isn’t in your portfolio." };
  const checked = requestSchema.safeParse({ kind: input.kind, description: input.description, dueInDays: input.dueInDays });
  if (!checked.success) return { ok: false, message: "Say what you are waiting on (up to 200 characters) and when to start reminding (1–60 days)." };
  const { openInformationRequest } = await import("@/lib/automations/handlers");
  await openInformationRequest(access.tenant, { contactId: input.contactId, leadId: input.leadId, kind: checked.data.kind, description: checked.data.description, dueAt: checked.data.dueInDays ? new Date(Date.now() + checked.data.dueInDays * 86_400_000) : null });
  revalidatePath("/console");
  return { ok: true, message: "Request opened. Reminders will go out automatically." };
}

export async function closeRequest(tenantId: string, requestId: string, received: boolean): Promise<ActionResult> {
  const { tenants } = await getConsoleContext();
  if (!tenants.some((t) => t.tenant.id === tenantId)) return { ok: false, message: "That workspace isn’t in your portfolio." };
  const updated = await repository.updateInformationRequest(tenantId, requestId, received ? { status: "RECEIVED", receivedAt: new Date() } : { status: "CANCELLED" });
  if (!updated) return { ok: false, message: "Request not found." };
  await repository.cancelActions(tenantId, `request:${requestId}:`);
  await repository.recordAutomationRun(tenantId, { typeKey: "chase_information", outcome: "COMPLETED", summary: received ? `Received ${updated.description}. No more reminders.` : `Stopped chasing ${updated.description}.`, contactId: updated.contactId, leadId: updated.leadId });
  revalidatePath("/console");
  return { ok: true, message: received ? "Marked received." : "Closed." };
}

export async function markReviewReplied(tenantId: string, reviewId: string): Promise<ActionResult> {
  const { tenants } = await getConsoleContext();
  if (!tenants.some((t) => t.tenant.id === tenantId)) return { ok: false, message: "That workspace isn’t in your portfolio." };
  const review = await repository.markReviewReplied(tenantId, reviewId, null);
  if (!review) return { ok: false, message: "Review not found." };
  const open = await repository.listMissedOpportunities(tenantId, { status: ["DETECTED", "RECOVERING", "ESCALATED"], limit: 500 });
  for (const m of open.filter((x) => x.dedupeKey === `UNANSWERED_REVIEW:${review.id}`)) await repository.resolveMissedOpportunity(tenantId, m.id, "RECOVERED", m.estimatedValueCents);
  revalidatePath("/console");
  return { ok: true, message: "Marked replied." }
}
