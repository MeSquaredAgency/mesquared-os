import { repository } from "@/lib/data";
import { emit } from "@/lib/events";
import { opportunityValue } from "@/lib/opportunities/detect";
import { registerAutomations } from "@/lib/automations/handlers";
import { registerPlaybook } from "@/lib/playbook";
import { getQualifier, type QualificationResult } from "@/lib/qualify";
import { bookingLinkFor } from "@/lib/scheduling/calcom";
import type { LeadRecord, TenantSummary } from "@/lib/types";
import type { IntakeChannel } from "@/lib/data/repository";
import { redactPayload, splitName, toE164, type IntakeBody } from "./schema";

export type IntakeOutcome =
  | { outcome: "created"; lead: LeadRecord; qualification: QualificationResult; bookingUrl: string | null }
  | { outcome: "duplicate"; lead: LeadRecord }
  | { outcome: "dry_run"; qualification: QualificationResult }
  /** The workspace's daily intake cap was reached: nothing was classified or stored beyond the intake event. */
  | { outcome: "capped"; retryAfterSeconds: number };

export interface IntakeMeta {
  channel: IntakeChannel;
  provider: string | null;
}

const CHANNEL_FOR_SOURCE: Partial<Record<IntakeBody["source"], IntakeChannel>> = {
  WEB_FORM: "WEB_FORM",
  LANDING_PAGE: "WEB_FORM",
  META_LEAD_FORM: "META_LEAD_FORM",
  GOOGLE_LEAD_FORM: "GOOGLE_LEAD_FORM",
  SOCIAL_DM: "SOCIAL_DM",
  SOCIAL_COMMENT: "SOCIAL_COMMENT",
  PORTAL_EMAIL: "PORTAL_EMAIL",
  EMAIL: "EMAIL_FORWARD",
  PHONE: "CALL",
};

/**
 * Full intake pipeline for one item, from any channel:
 *   validate (caller) → dedupe → qualify → contact → lead on the default pipeline → playbook
 *
 * Dedupe runs before qualification so a retry never costs a model call.
 * GREEN leads get SLA deadlines from the tenant's service levels and a
 * booking link ready for the messaging adapter; RED items are logged as
 * handled. Everything emits events for the activity log and detectors.
 */

/** Same upstream id, or the same words (and the same property, when one was named) from the same person. */
function isSameEnquiry(existing: LeadRecord, body: IntakeBody): boolean {
  if (body.externalId && existing.externalId === body.externalId) return true;
  const norm = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().toLowerCase() : "");
  const sameProperty = norm(existing.attributes.property) === norm(body.fields?.property);
  const message = norm(body.message);
  if (!message) return sameProperty;
  return message === norm(existing.message) && sameProperty;
}

export async function processIntake(tenant: TenantSummary, input: IntakeBody, rawPayload: Record<string, unknown>, meta?: Partial<IntakeMeta>): Promise<IntakeOutcome> {
  registerPlaybook();
  registerAutomations();
  // Phones are stored and messaged in E.164, using the tenant's region when the country code was omitted.
  const body: IntakeBody = { ...input, phone: toE164(input.phone, tenant.region) };
  const { firstName, lastName } = splitName(body);
  const payload = redactPayload(rawPayload) as Record<string, unknown>;
  const channel: IntakeChannel = meta?.channel ?? CHANNEL_FOR_SOURCE[body.source] ?? "API";
  const provider = meta?.provider ?? null;
  const eventBase = { channel, provider, externalId: body.externalId, payload };

  if (!body.dryRun) {
    const duplicate = await repository.findDuplicateLead(tenant.id, { externalId: body.externalId, email: body.email, phone: body.phone });
    // The same submission again (same upstream id, or the same words from the same person within a day) is a
    // duplicate. A different message from a known person is a new enquiry and gets its own lead, reply and alert.
    if (duplicate && isSameEnquiry(duplicate, body)) {
      await repository.recordIntakeEvent(tenant.id, { ...eventBase, contactId: duplicate.contactId, leadId: duplicate.id, outcome: "DUPLICATE", classifier: null });
      return { outcome: "duplicate", lead: duplicate };
    }
  }

  if (!body.dryRun) {
    // A public key cannot be used to run up classifier spend or flood the queue: one fixed daily cap per workspace,
    // counted in the database so every instance sees the same number.
    const cap = Number.parseInt(process.env.INTAKE_DAILY_CAP ?? "500", 10) || 500;
    const day = 24 * 3_600_000;
    const { count, windowStart } = await repository.rateLimitHit(`intake:day:${tenant.id}`, day);
    if (count > cap) {
      await repository.recordIntakeEvent(tenant.id, { ...eventBase, contactId: null, leadId: null, outcome: "REJECTED", classifier: null });
      console.warn(`[intake] daily cap of ${cap} reached for ${tenant.slug}; refusing further enquiries until the window resets`);
      return { outcome: "capped", retryAfterSeconds: Math.max(60, Math.ceil((windowStart.getTime() + day - Date.now()) / 1000)) };
    }
  }

  const qualifier = await getQualifier();
  const qualification = await qualifier.qualify(
    { source: body.source, firstName, lastName, email: body.email, phone: body.phone, company: body.company, message: body.message, attributes: body.fields },
    tenant.qualificationRules,
  );
  if (body.dryRun) return { outcome: "dry_run", qualification };

  const contact = await repository.upsertContact(tenant.id, { firstName, lastName, email: body.email, phone: body.phone, company: body.company });

  const green = qualification.ticketType === "GREEN";
  const config = green ? await repository.getTenantConfig(tenant.id) : null;
  const pipeline = config?.pipelines.find((p) => p.isDefault) ?? config?.pipelines[0] ?? null;
  const firstStage = pipeline?.stages[0] ?? null;
  const now = Date.now();

  const { lead, created } = await repository.createLead(tenant.id, {
    contactId: contact.id,
    source: body.source,
    externalId: body.externalId,
    firstName,
    lastName,
    email: body.email,
    phone: body.phone,
    company: body.company,
    message: body.message,
    attributes: body.fields,
    attribution: pickAttribution(body.fields),
    ticketType: qualification.ticketType,
    intentScore: qualification.intentScore,
    qualificationReason: qualification.reason,
    qualifiedBy: qualification.classifier,
    pipelineId: pipeline?.id ?? null,
    stageId: firstStage?.id ?? null,
    valueCents: green ? opportunityValue(tenant, "NOT_BOOKED") : 0,
    respondBy: green ? new Date(now + tenant.sla.firstResponseMinutes * 60_000) : null,
    bookBy: green ? new Date(now + tenant.sla.bookingWindowHours * 60 * 60_000) : null,
  });
  if (!created) {
    await repository.recordIntakeEvent(tenant.id, { ...eventBase, contactId: contact.id, leadId: lead.id, outcome: "DUPLICATE", classifier: qualification.classifier });
    return { outcome: "duplicate", lead };
  }

  await repository.recordIntakeEvent(tenant.id, { ...eventBase, contactId: contact.id, leadId: lead.id, outcome: "CREATED", classifier: qualification.classifier });
  await emit(tenant.id, "intake.received", { leadId: lead.id, contactId: contact.id, channel, source: body.source });

  let bookingUrl: string | null = null;

  // RED enquiries are answered (or honestly logged as filed) by the automation layer off lead.qualified.
  if (green) bookingUrl = await bookingLinkFor(tenant, lead);

  // The green-lead playbook (acknowledgement, alerts, booking) runs off this event.
  await emit(tenant.id, "lead.qualified", { leadId: lead.id, tenantSlug: tenant.slug, ticketType: qualification.ticketType, intentScore: qualification.intentScore, classifier: qualification.classifier });

  return { outcome: "created", lead, qualification, bookingUrl };
}

/** Lifts UTM-style keys out of the form fields into structured attribution. */
function pickAttribution(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const map: Record<string, string> = { utm_source: "source", utm_medium: "medium", utm_campaign: "campaign", utm_content: "content", utm_term: "term", gclid: "clickId", fbclid: "clickId" };
  for (const [key, target] of Object.entries(map)) {
    const v = fields[key];
    if (typeof v === "string" && v) out[target] = v;
  }
  return out;
}
