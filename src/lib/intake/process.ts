import { repository } from "@/lib/data";
import { getQualifier, type QualificationResult } from "@/lib/qualify";
import type { LeadRecord, TenantSummary } from "@/lib/types";
import { splitName, type IntakeBody } from "./schema";

export type IntakeOutcome =
  | { outcome: "created"; lead: LeadRecord; qualification: QualificationResult; bookingUrl: string | null; taskId: string }
  | { outcome: "duplicate"; lead: LeadRecord }
  | { outcome: "dry_run"; qualification: QualificationResult };

/**
 * Full intake pipeline for one lead:
 *   validate (done by caller) → dedupe → qualify → persist → route
 *
 * Routing follows the Green/Red ticket model:
 *   GREEN → booking link generated, urgent follow-up task for the account manager
 *   RED   → nurture task queued for automation
 */
export async function processIntake(tenant: TenantSummary, body: IntakeBody, rawPayload: Record<string, unknown>): Promise<IntakeOutcome> {
  const { firstName, lastName } = splitName(body);
  const qualifier = await getQualifier();

  const qualification = await qualifier.qualify(
    {
      source: body.source,
      firstName,
      lastName,
      email: body.email,
      phone: body.phone,
      company: body.company,
      message: body.message,
      attributes: body.fields,
    },
    tenant.qualificationRules,
  );

  if (body.dryRun) return { outcome: "dry_run", qualification };

  const duplicate = await repository.findDuplicateLead(tenant.id, {
    externalId: body.externalId,
    email: body.email,
    phone: body.phone,
  });
  if (duplicate) {
    await repository.recordIntakeEvent(tenant.id, {
      leadId: duplicate.id,
      source: body.source,
      outcome: "duplicate",
      payload: rawPayload,
      classifier: qualification.classifier,
    });
    return { outcome: "duplicate", lead: duplicate };
  }

  const lead = await repository.createLead(tenant.id, {
    source: body.source,
    externalId: body.externalId,
    firstName,
    lastName,
    email: body.email,
    phone: body.phone,
    company: body.company,
    message: body.message,
    rawPayload,
    attributes: body.fields,
    ticketType: qualification.ticketType,
    intentScore: qualification.intentScore,
    qualificationReason: qualification.reason,
    qualifiedBy: qualification.classifier,
  });

  const displayName = [firstName, lastName].filter(Boolean).join(" ") || body.email || body.phone || "New lead";
  let bookingUrl: string | null = null;
  let taskId: string;

  if (qualification.ticketType === "GREEN") {
    bookingUrl = buildBookingUrl(tenant, lead);
    await repository.createBooking(tenant.id, { leadId: lead.id, bookingUrl });
    const task = await repository.createTask(tenant.id, {
      leadId: lead.id,
      type: "GREEN",
      title: `Follow up ${displayName} — booking link sent`,
      description: qualification.reason,
      priority: qualification.intentScore >= 85 ? "URGENT" : "HIGH",
      dueAt: new Date(Date.now() + 60 * 60_000),
      automationKey: "green:follow-up-call",
    });
    taskId = task.id;
    // TODO(messaging): notify the account manager (Resend / Twilio) and send the booking link to the lead.
  } else {
    const task = await repository.createTask(tenant.id, {
      leadId: lead.id,
      type: "RED",
      title: `Nurture ${displayName}`,
      description: qualification.reason,
      priority: "LOW",
      dueAt: null,
      automationKey: "nurture:welcome",
    });
    taskId = task.id;
    // TODO(automation): enqueue the tenant's nurture sequence.
  }

  await repository.recordIntakeEvent(tenant.id, {
    leadId: lead.id,
    source: body.source,
    outcome: "created",
    payload: rawPayload,
    classifier: qualification.classifier,
  });

  return { outcome: "created", lead, qualification, bookingUrl, taskId };
}

/**
 * Placeholder booking link until the Cal.com / Google Calendar adapter lands.
 * The URL is tenant-scoped so the scheduling engine can resolve branding and
 * availability per client.
 */
function buildBookingUrl(tenant: TenantSummary, lead: LeadRecord) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/book/${tenant.slug}?lead=${lead.id}`;
}
