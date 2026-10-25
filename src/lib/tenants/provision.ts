import { randomBytes } from "node:crypto";
import { hashPassword } from "@/lib/auth/password";
import { hashApiKey } from "@/lib/crypto";
import { repository } from "@/lib/data";
import type { ApiKeyScope } from "@/lib/data/repository";
import { emit } from "@/lib/events";
import { TEMPLATE_BY_KEY } from "@/lib/templates";
import type { ApiKeyRecord, TenantSummary, UserRecord } from "@/lib/types";

/**
 * Provisioning: a new workspace is configuration applied to a template, never
 * code. Everything a client needs (roles, pipelines, modules, automations,
 * brand profile) comes from the template; the operator then fills in what is
 * specific to the business in the console settings.
 */

export interface ProvisionInput {
  templateKey: string;
  name: string;
  slug: string;
  region: string;
  timezone: string;
  locale: string;
  currency: string;
  fromName?: string | null;
  replyTo?: string | null;
  primaryColor?: string | null;
  serviceAreas?: string[];
  /** The line every asset must carry, e.g. a licence number. */
  requiredFooter?: string | null;
}

export function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

export async function provisionTenant(input: ProvisionInput): Promise<TenantSummary> {
  const template = TEMPLATE_BY_KEY[input.templateKey];
  if (!template) throw new Error(`Unknown template ${input.templateKey}`);
  const slug = slugify(input.slug || input.name);
  if (slug.length < 3) throw new Error("The workspace address needs at least three characters.");
  const tenant = await repository.createTenant({
    slug,
    name: input.name.trim(),
    industry: template.industry,
    templateKey: template.key,
    region: input.region.toUpperCase(),
    timezone: input.timezone,
    locale: input.locale,
    currency: input.currency.toUpperCase(),
    branding: { ...(input.fromName ? { fromName: input.fromName } : {}), ...(input.replyTo ? { replyTo: input.replyTo } : {}), ...(input.primaryColor ? { primaryColor: input.primaryColor } : {}), ...(input.requiredFooter?.trim() ? { footer: input.requiredFooter.trim() } : {}) },
    qualificationRules: { ...template.qualificationRules, ...(input.serviceAreas?.length ? { serviceAreas: input.serviceAreas } : {}) },
    sla: template.sla,
    opportunityValues: template.opportunityValues,
  });
  try {
    await repository.applyTemplate(tenant.id, template);
    if (input.requiredFooter?.trim()) await repository.updateBrandProfile(tenant.id, { complianceBlock: { requiredFooter: input.requiredFooter.trim() } });
    await repository.recordAutomationRun(tenant.id, { typeKey: "sla_watch", outcome: "COMPLETED", summary: `Workspace set up from the ${template.name} template.` });
    await emit(tenant.id, "tenant.provisioned", { templateKey: template.key });
  } catch (error) {
    // Never leave a half-configured workspace in the portfolio: park it and let the operator try again under a new address.
    await repository.updateTenant(tenant.id, { isActive: false }).catch(() => undefined);
    throw error;
  }
  return (await repository.findTenantById(tenant.id)) ?? tenant;
}

/** A readable one-time password: four lowercase words of letters and digits, no ambiguous characters. */
export function temporaryPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += alphabet[bytes[i] % alphabet.length];
    if (i % 4 === 3 && i < 15) out += "-";
  }
  return out;
}

export interface InviteResult {
  user: UserRecord;
  /** Set only when a new account was created or the password was reset; shown once. */
  temporaryPassword: string | null;
  created: boolean;
}

/** Adds a person to a workspace with a role. New accounts get a one-time password to hand over; existing ones keep theirs. */
export async function inviteMember(tenantId: string, input: { email: string; name: string | null; roleId: string; resetPassword?: boolean }): Promise<InviteResult> {
  const email = input.email.trim().toLowerCase();
  const existing = await repository.findUserByEmail(email);
  let user = existing?.user ?? null;
  let temp: string | null = null;
  let created = false;
  if (!user) {
    temp = temporaryPassword();
    user = await repository.createUser({ email, name: input.name?.trim() || null, passwordHash: await hashPassword(temp) });
    created = true;
  } else if (input.resetPassword) {
    temp = temporaryPassword();
    await repository.setUserPassword(user.id, await hashPassword(temp));
  }
  await repository.upsertMembership(tenantId, user.id, input.roleId);
  return { user, temporaryPassword: temp, created };
}

export interface IssuedKey {
  key: ApiKeyRecord;
  /** The raw key, shown once. */
  raw: string;
}

export async function issueApiKey(tenantId: string, label: string, scopes: ApiKeyScope[]): Promise<IssuedKey> {
  const raw = `msq_live_${randomBytes(24).toString("base64url")}`;
  const key = await repository.createApiKey(tenantId, { label: label.trim() || "API key", keyHash: hashApiKey(raw), keyPrefix: raw.slice(0, 15), scopes: scopes.length ? scopes : ["intake"] });
  return { key, raw };
}

export const REGION_PRESETS: { region: string; timezone: string; locale: string; currency: string; label: string }[] = [
  { region: "AU", timezone: "Australia/Adelaide", locale: "en-AU", currency: "AUD", label: "Australia (Adelaide)" },
  { region: "AU", timezone: "Australia/Sydney", locale: "en-AU", currency: "AUD", label: "Australia (Sydney / Melbourne)" },
  { region: "AU", timezone: "Australia/Brisbane", locale: "en-AU", currency: "AUD", label: "Australia (Brisbane)" },
  { region: "AU", timezone: "Australia/Perth", locale: "en-AU", currency: "AUD", label: "Australia (Perth)" },
  { region: "NZ", timezone: "Pacific/Auckland", locale: "en-NZ", currency: "NZD", label: "New Zealand" },
  { region: "GB", timezone: "Europe/London", locale: "en-GB", currency: "GBP", label: "United Kingdom" },
  { region: "US", timezone: "America/New_York", locale: "en-US", currency: "USD", label: "United States (Eastern)" },
  { region: "US", timezone: "America/Los_Angeles", locale: "en-US", currency: "USD", label: "United States (Pacific)" },
  { region: "KH", timezone: "Asia/Phnom_Penh", locale: "en-AU", currency: "USD", label: "Cambodia" },
  { region: "SG", timezone: "Asia/Singapore", locale: "en-SG", currency: "SGD", label: "Singapore" },
];
