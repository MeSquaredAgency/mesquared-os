import { z } from "zod";
import { repository } from "@/lib/data";
import type { TenantPatch } from "@/lib/data/repository";
import { MISSED_OPPORTUNITY_TYPES, type EscalationRule, type MissedOpportunityType } from "@/lib/types";

/**
 * The business settings a workspace definition (`tenants/<slug>.json`) can
 * carry beyond the basics `scripts/provision.ts` has always taken: service
 * levels, qualification, brand, missed-opportunity values, posting rhythm,
 * the review link, switch-offs and escalation. Every key is optional; what is
 * left out keeps the template's value. The onboarding questionnaire importer
 * (`src/lib/onboarding/questionnaire.ts`) produces exactly this shape.
 */
const list = z.array(z.string().trim().min(1).max(300)).max(40);
const hour = z.number().int().min(0).max(23);

export const tenantSettingsSchema = z.object({
  sla: z
    .object({
      firstResponseMinutes: z.number().int().min(1).max(1440).optional(),
      bookingWindowHours: z.number().int().min(1).max(720).optional(),
      quietHours: z.object({ start: hour, end: hour }).optional(),
    })
    .optional(),
  qualification: z
    .object({
      greenCriteria: list.optional(),
      highIntentServices: list.optional(),
      autoHandled: list.optional(),
      requirePhone: z.boolean().optional(),
    })
    .optional(),
  brand: z
    .object({
      voice: z.string().trim().max(500).optional(),
      examples: z.array(z.string().trim().min(1).max(2000)).max(10).optional(),
      /** Added to the template's banned phrases, never replacing them. */
      bannedPhrases: list.optional(),
      claimsPolicy: z.string().trim().max(500).optional(),
    })
    .optional(),
  /** Whole units of the workspace currency (dollars, not cents), as the console's values form takes them. */
  opportunityValues: z.partialRecord(z.enum(MISSED_OPPORTUNITY_TYPES as [MissedOpportunityType, ...MissedOpportunityType[]]), z.number().min(0).max(10_000_000)).optional(),
  content: z
    .object({
      postsPerWeek: z.number().int().min(1).max(28).optional(),
      /** day is 0–6, Sunday to Saturday, in the workspace timezone. */
      slots: z.array(z.object({ day: z.number().int().min(0).max(6), hour })).max(28).optional(),
    })
    .optional(),
  reviewUrl: z.string().trim().url().optional(),
  switchOff: z.object({ modules: z.array(z.string()).optional(), automations: z.array(z.string()).optional() }).optional(),
  /** `when` is a missed-opportunity type or "*"; `email` must belong to a member of the workspace. */
  escalation: z.array(z.object({ when: z.string(), email: z.string().trim().email() })).max(20).optional(),
});

export type TenantSettingsInput = z.infer<typeof tenantSettingsSchema>;

/**
 * Applies the settings to an existing workspace through the repository, so it
 * behaves the same in demo mode and on Postgres. Run it after people are
 * invited: escalation rules name members by email. Returns one line per change
 * for the provisioning log; nothing in it is secret.
 */
export async function applyTenantSettings(tenantId: string, input: TenantSettingsInput): Promise<string[]> {
  const settings = tenantSettingsSchema.parse(input);
  const tenant = await repository.findTenantById(tenantId);
  if (!tenant) throw new Error(`workspace ${tenantId} not found`);
  const log: string[] = [];
  const patch: TenantPatch = {};

  if (settings.sla) {
    patch.sla = { ...tenant.sla, ...settings.sla };
    log.push(`service levels: ${patch.sla.firstResponseMinutes} min to first reply, ${patch.sla.bookingWindowHours} h to book${patch.sla.quietHours ? `, quiet ${patch.sla.quietHours.start}:00–${patch.sla.quietHours.end}:00` : ""}`);
  }
  if (settings.qualification) {
    const q = settings.qualification;
    patch.qualificationRules = { ...tenant.qualificationRules, ...(q.greenCriteria ? { greenCriteria: q.greenCriteria } : {}), ...(q.highIntentServices ? { highIntentServices: q.highIntentServices } : {}), ...(q.autoHandled ? { autoHandled: q.autoHandled } : {}), ...(q.requirePhone !== undefined ? { requirePhone: q.requirePhone } : {}) };
    log.push(`qualification: ${patch.qualificationRules.greenCriteria?.length ?? 0} signals worth a person's time, ${patch.qualificationRules.autoHandled?.length ?? 0} kinds handled automatically`);
  }
  if (settings.opportunityValues) {
    const next = { ...tenant.opportunityValues };
    for (const [type, value] of Object.entries(settings.opportunityValues)) if (value !== undefined) next[type as MissedOpportunityType] = Math.round(value * 100);
    patch.opportunityValues = next;
    log.push(`missed-opportunity values: ${Object.keys(settings.opportunityValues).length} set`);
  }
  if (settings.escalation) {
    const people = await repository.listTenantPeople(tenantId);
    const rules: EscalationRule[] = [];
    for (const rule of settings.escalation) {
      if (rule.when !== "*" && !MISSED_OPPORTUNITY_TYPES.includes(rule.when as MissedOpportunityType)) throw new Error(`escalation "when" must be a missed-opportunity type or "*", got ${rule.when}`);
      const person = people.find((p) => p.via === "member" && p.email.toLowerCase() === rule.email.toLowerCase());
      if (!person) throw new Error(`escalation names ${rule.email}, who is not a member of this workspace; list them under "people" first`);
      rules.push({ when: rule.when, notifyUserId: person.userId });
    }
    patch.escalationRules = rules;
    log.push(`escalation: ${rules.length} rule${rules.length === 1 ? "" : "s"}`);
  }
  if (Object.keys(patch).length) await repository.updateTenant(tenantId, patch);

  if (settings.brand) {
    const config = await repository.getTenantConfig(tenantId);
    const b = settings.brand;
    const banned = b.bannedPhrases ? [...new Set([...(config.brand?.bannedPhrases ?? []), ...b.bannedPhrases])] : undefined;
    await repository.updateBrandProfile(tenantId, { ...(b.voice ? { voice: b.voice } : {}), ...(b.examples ? { examples: b.examples } : {}), ...(banned ? { bannedPhrases: banned } : {}), complianceBlock: { ...(b.claimsPolicy ? { claimsPolicy: b.claimsPolicy } : {}) } });
    log.push(`brand: ${[b.voice ? "voice" : null, b.examples ? `${b.examples.length} example${b.examples.length === 1 ? "" : "s"}` : null, banned ? `${banned.length} banned phrases` : null, b.claimsPolicy ? "claims policy" : null].filter(Boolean).join(", ")}`);
  }
  if (settings.content && (settings.content.postsPerWeek || settings.content.slots?.length)) {
    await repository.setModule(tenantId, "content", { settings: { ...(settings.content.postsPerWeek ? { postsPerWeek: settings.content.postsPerWeek } : {}), ...(settings.content.slots?.length ? { slots: settings.content.slots } : {}) } });
    log.push(`content: ${settings.content.postsPerWeek ?? "template"} posts a week${settings.content.slots?.length ? `, ${settings.content.slots.length} posting slots` : ""}`);
  }
  if (settings.reviewUrl) {
    await repository.setAutomation(tenantId, "review_request", { settings: { reviewUrl: settings.reviewUrl } });
    log.push("review requests: link set");
  }
  for (const key of settings.switchOff?.modules ?? []) {
    await repository.setModule(tenantId, key, { enabled: false });
    log.push(`module ${key}: off`);
  }
  for (const key of settings.switchOff?.automations ?? []) {
    await repository.setAutomation(tenantId, key, { enabled: false });
    log.push(`automation ${key}: off`);
  }
  return log;
}
