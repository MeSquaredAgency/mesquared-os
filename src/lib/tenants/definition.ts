import { repository } from "@/lib/data";
import { normalizePhone } from "@/lib/intake/schema";
import { TEMPLATE_BY_KEY } from "@/lib/templates";
import type { TenantSummary } from "@/lib/types";
import { inviteMember, provisionTenant, slugify } from "./provision";
import { applyTenantSettings, tenantSettingsSchema, type TenantSettingsInput } from "./settings";

/**
 * A whole workspace described as data: what `tenants/<slug>.json` holds and
 * what the onboarding form drafts. Applying one is the only way a client is
 * set up from a file or a submission, so the script and the console's
 * "Create workspace" button behave identically.
 */
export interface TenantDefinition extends TenantSettingsInput {
  templateKey: string;
  name: string;
  slug?: string;
  region: string;
  timezone: string;
  locale: string;
  currency: string;
  fromName?: string;
  replyTo?: string;
  primaryColor?: string;
  serviceAreas?: string[];
  requiredFooter?: string;
  signAsAssignee?: boolean;
  smsNumber?: string;
  logoUrl?: string;
  website?: string;
  phone?: string;
  addresses?: string[];
  social?: { facebook?: string; instagram?: string; youtube?: string; linkedin?: string };
  people?: { email: string; name: string; role: string; title?: string; mobile?: string; photo?: string }[];
}

/** Everything that can be wrong with a definition, found before anything is written. Empty when it is good to apply. */
export function definitionProblems(def: TenantDefinition): string[] {
  const problems: string[] = [];
  const template = TEMPLATE_BY_KEY[def.templateKey];
  if (!template) problems.push(`unknown template ${def.templateKey}`);
  if (!def.name?.trim()) problems.push("the business needs a name");
  if (slugify(def.slug || def.name || "").length < 3) problems.push("the workspace address needs at least three characters");
  const settings = tenantSettingsSchema.safeParse(def);
  if (!settings.success) problems.push(`invalid settings: ${settings.error.issues.map((i) => `${i.path.join(".")} (${i.message})`).join("; ")}`);
  if (def.smsNumber) {
    const number = normalizePhone(def.smsNumber);
    if (!number || !number.startsWith("+")) problems.push(`smsNumber must be in E.164 form (+614...), got ${def.smsNumber}`);
  }
  for (const person of def.people ?? []) if (template && !template.roles.some((r) => r.key === person.role)) problems.push(`role "${person.role}" for ${person.email} is not in the ${template.name} template`);
  const escalated = new Set((def.escalation ?? []).map((e) => e.email.toLowerCase()));
  for (const email of escalated) if (!(def.people ?? []).some((p) => p.email.toLowerCase() === email)) problems.push(`escalation names ${email}, who is not listed under people`);
  return problems;
}

/**
 * Creates the workspace from the template (or, with `refresh`, updates an
 * existing one with the same address), then sets branding, the SMS number,
 * people and the business settings. Returns one line per step for a log;
 * nothing in it is secret. People are created with a password nobody sees: an
 * operator resets it from Settings → People and hands it over privately.
 */
export async function applyDefinition(def: TenantDefinition, opts: { refresh: boolean }): Promise<{ tenant: TenantSummary; created: boolean; log: string[] }> {
  const problems = definitionProblems(def);
  if (problems.length) throw new Error(problems.join("; "));
  const template = TEMPLATE_BY_KEY[def.templateKey];
  const settings = tenantSettingsSchema.parse(def);
  const log: string[] = [];

  // 1. The workspace: created from the template, or its settings refreshed.
  const slug = slugify(def.slug || def.name);
  let tenant = await repository.findTenantBySlug(slug);
  const created = !tenant;
  if (!tenant) {
    tenant = await provisionTenant({ templateKey: def.templateKey, name: def.name, slug, region: def.region, timezone: def.timezone, locale: def.locale, currency: def.currency, fromName: def.fromName ?? null, replyTo: def.replyTo ?? null, primaryColor: def.primaryColor ?? null, serviceAreas: def.serviceAreas ?? [], requiredFooter: def.requiredFooter ?? null });
    log.push(`tenant   ${tenant.slug} created from the ${template.name} template`);
  } else if (opts.refresh) {
    log.push(`tenant   ${tenant.slug} exists; refreshing settings`);
  } else {
    throw new Error(`The workspace address "${slug}" is already taken.`);
  }
  tenant =
    (await repository.updateTenant(tenant.id, {
      name: def.name,
      region: def.region.toUpperCase(),
      timezone: def.timezone,
      locale: def.locale,
      currency: def.currency.toUpperCase(),
      branding: { ...tenant.branding, ...(def.fromName ? { fromName: def.fromName } : {}), ...(def.replyTo ? { replyTo: def.replyTo } : {}), ...(def.primaryColor ? { primaryColor: def.primaryColor } : {}), ...(def.signAsAssignee !== undefined ? { signAsAssignee: def.signAsAssignee } : {}), ...(def.requiredFooter ? { footer: def.requiredFooter } : {}), ...(def.logoUrl ? { logoUrl: def.logoUrl } : {}), ...(def.website ? { website: def.website } : {}), ...(def.phone ? { phone: def.phone } : {}), ...(def.addresses ? { addresses: def.addresses } : {}), ...(def.social ? { social: def.social } : {}) },
      qualificationRules: { ...tenant.qualificationRules, ...(def.serviceAreas?.length ? { serviceAreas: def.serviceAreas } : {}) },
    })) ?? tenant;
  if (def.requiredFooter) await repository.updateBrandProfile(tenant.id, { complianceBlock: { requiredFooter: def.requiredFooter } });

  // 2. The workspace's SMS number: texts go out from it and replies to it are
  // routed back to this workspace (Twilio credentials stay in the deployment).
  if (def.smsNumber) {
    const number = normalizePhone(def.smsNumber)!;
    await repository.upsertIntegration(tenant.id, { provider: "TWILIO", externalAccountId: number, label: "SMS", status: "CONNECTED", settings: { fromNumber: number } });
    log.push(`sms      ${number} attached`);
  }

  // 3. People by template role key.
  const config = await repository.getTenantConfig(tenant.id);
  for (const person of def.people ?? []) {
    const roleDef = template.roles.find((r) => r.key === person.role)!;
    const role = config.roles.find((r) => r.name === roleDef.name);
    if (!role) throw new Error(`role "${roleDef.name}" missing on the workspace; re-apply the template`);
    const result = await inviteMember(tenant.id, { email: person.email, name: person.name, roleId: role.id, profile: { title: person.title ?? null, phone: person.mobile ?? null, photoUrl: person.photo ?? null } });
    log.push(`person   ${person.email} → ${role.name}${result.created ? " (created; reset the password from Settings → People to hand it over)" : ""}`);
  }

  // 4. Business settings: service levels, qualification, brand, values, posting rhythm, escalation.
  for (const line of await applyTenantSettings(tenant.id, settings)) log.push(`settings ${line}`);
  return { tenant: (await repository.findTenantById(tenant.id)) ?? tenant, created, log };
}
