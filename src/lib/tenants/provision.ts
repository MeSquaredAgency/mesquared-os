import { randomBytes } from "node:crypto";
import { hashPassword } from "@/lib/auth/password";
import { hashApiKey } from "@/lib/crypto";
import { repository } from "@/lib/data";
import type { MemberProfile } from "@/lib/data/repository";
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

/** Console pages that sit beside /console/<workspace>: a workspace with one of these addresses would be unreachable. */
const RESERVED_SLUGS = new Set(["new", "queue", "onboarding"]);

export function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

export async function provisionTenant(input: ProvisionInput): Promise<TenantSummary> {
  const template = TEMPLATE_BY_KEY[input.templateKey];
  if (!template) throw new Error(`Unknown template ${input.templateKey}`);
  const slug = slugify(input.slug || input.name);
  if (slug.length < 3) throw new Error("The workspace address needs at least three characters.");
  if (RESERVED_SLUGS.has(slug)) throw new Error(`"${slug}" is a console page; choose another workspace address.`);
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
export async function inviteMember(tenantId: string, input: { email: string; name: string | null; roleId: string; resetPassword?: boolean; profile?: MemberProfile }): Promise<InviteResult> {
  const email = input.email.trim().toLowerCase();
  const existing = await repository.findUserByEmail(email);
  let user = existing?.user ?? null;
  let temp: string | null = null;
  let created = false;
  if (!user) {
    temp = temporaryPassword();
    user = await repository.createUser({ email, name: input.name?.trim() || null, passwordHash: await hashPassword(temp) });
    created = true;
  } else {
    // An existing account is only touched within its own workspace: Me² staff accounts are never made client
    // members, and a password is only reset for someone who is already a member here, so an operator of one
    // workspace cannot take over a user of another (or a platform admin) by "inviting" their email.
    if (user.isOperator || user.isPlatformAdmin) throw new Error("That email belongs to a Me² account; it cannot be added as a client member.");
    if (input.resetPassword) {
      const member = (await repository.listTenantPeople(tenantId)).some((p) => p.userId === user!.id && p.via === "member");
      if (!member) throw new Error("Only an existing member of this workspace can have their password reset here.");
      temp = temporaryPassword();
      await repository.setUserPassword(user.id, await hashPassword(temp));
    }
  }
  await repository.upsertMembership(tenantId, user.id, input.roleId, input.profile);
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

/** Kept in a client-safe module so forms can list them; re-exported here for existing callers. */
export { REGION_PRESETS } from "./regions";
