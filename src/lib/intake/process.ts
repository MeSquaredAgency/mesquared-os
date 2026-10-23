import { repository } from "@/lib/data";
import { getQualifier, type QualificationResult } from "@/lib/qualify";
import type { LeadRecord, TenantSummary } from "@/lib/types";
import { redactPayload, splitName, type IntakeBody } from "./schema";

export type IntakeOutcome =
  | { outcome: "created"; lead: LeadRecord; qualification: QualificationResult; bookingUrl: string | null; taskId: string }
  | { outcome: "duplicate"; lead: LeadRecord }
  | { outcome: "dry_run"; qualification: QualificationResult };

/**
 * Full intake pipeline for one lead:
 *   validate (caller) → dedupe → qualify → persist → route
 *
 * Dedupe runs before qualification so a duplicate never costs a model call.
 * Routing follows the Green/Red ticket model:
 *   GREEN → booking link generated (delivery is the messaging adapter's job), urgent follow-up task
 *   RED   → nurture task queued for automation
 */
export async function processIntake(tenant: TenantSummary, body: IntakeBody, rawPayload: Record<string, unknown>): Promise<IntakeOutcome> {
  const { firstName, lastName } = splitName(body);
  const payload = redactPayload(rawPayload) as Record<string, unknown>;

  if (!body.dryRun) {
    const duplicate = await repository.findDuplicateLead(tenant.id, {
      externalId: body.externalId,
      email: body.email,
      phone: body.phone,
    });
    if (duplicate) {
      await repository.recordIntakeEvent(tenant.id, { leadId: duplicate.id, source: body.source, outcome: "DUPLICATE", payload, classifier: null });
      return { outcome: "duplicate", lead: duplicate };
    }
  }

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

  const { lead, created } = await repository.createLead(tenant.id, {
    source: body.source,
    externalId: body.externalId,
    firstName,
    lastName,
    email: body.email,
    phone: body.phone,
    company: body.company,
    message: body.message,
    attributes: body.fields,
    ticketType: qualification.ticketType,
    intentScore: qualification.intentScore,
    qualificationReason: qualification.reason,
    qualifiedBy: qualification.classifier,
  });
  if (!created) {
    // Lost a race with a concurrent request carrying the same externalId.
    await repository.recordIntakeEvent(tenant.id, { leadId: lead.id, source: body.source, outcome: "DUPLICATE", payload, classifier: qualification.classifier });
    return { outcome: "duplicate", lead };
  }

  const displayName = [firstName, lastName].filter(Boolean).join(" ") || body.email || body.phone || "New lead";
  let bookingUrl: string | null = null;
  let taskId: string;

  if (qualification.ticketType === "GREEN") {
    bookingUrl = buildBookingUrl(tenant, lead);
    // `sent: false` until the messaging adapter confirms delivery; the lead stays QUALIFIED until then.
    await repository.createBooking(tenant.id, { leadId: lead.id, bookingUrl, sent: false });
    const task = await repository.createTask(tenant.id, {
      leadId: lead.id,
      type: "GREEN",
      title: `Follow up ${displayName} — booking link ready`,
      description: qualification.reason,
      priority: qualification.intentScore >= 85 ? "URGENT" : "HIGH",
      dueAt: new Date(Date.now() + 60 * 60_000),
      automationKey: "green:follow-up-call",
    });
    taskId = task.id;
    // TODO(messaging): send the booking link to the lead and alert the account manager, then mark the booking sent.
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

  await repository.recordIntakeEvent(tenant.id, { leadId: lead.id, source: body.source, outcome: "CREATED", payload, classifier: qualification.classifier });

  return { outcome: "created", lead, qualification, bookingUrl, taskId };
}

/**
 * Tenant-scoped booking link, resolved by the scheduling engine. The public
 * base URL must be configured in production; a localhost link must never be
 * handed to an integrator by accident.
 */
function buildBookingUrl(tenant: TenantSummary, lead: LeadRecord) {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base) {
    if (process.env.NODE_ENV === "production") throw new Error("NEXT_PUBLIC_APP_URL must be set in production to build booking links.");
    return `http://localhost:3000/book/${tenant.slug}?lead=${lead.id}`;
  }
  return `${base.replace(/\/$/, "")}/book/${tenant.slug}?lead=${lead.id}`;
}
