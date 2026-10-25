"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getConsoleContext } from "@/lib/auth/access";
import { ForbiddenError } from "@/lib/auth/permissions";
import { repository } from "@/lib/data";
import type { ApiKeyScope } from "@/lib/data/repository";
import { csvToInventory, importInventory } from "@/lib/inventory";
import { TEMPLATE_BY_KEY } from "@/lib/templates";
import type { MissedOpportunityType, TenantSummary } from "@/lib/types";
import { inviteMember, issueApiKey, provisionTenant, slugify } from "./provision";

export interface ActionResult {
  ok: boolean;
  message: string;
}

const fail = (error: unknown): ActionResult => {
  if (error instanceof ForbiddenError) return { ok: false, message: error.message };
  if (error instanceof Error && /already (taken|exists)|at least three/.test(error.message)) return { ok: false, message: error.message };
  console.error("[tenants] action failed", error instanceof Error ? error.message : error);
  return { ok: false, message: "Something went wrong. Please try again." };
};

async function adminOnly(): Promise<string> {
  const { user } = await getConsoleContext();
  if (!user.isPlatformAdmin) throw new ForbiddenError("Only a platform admin can do that.");
  return user.id;
}

async function operatorTenant(tenantId: string): Promise<{ tenant: TenantSummary; isAdmin: boolean }> {
  const { tenants, user } = await getConsoleContext();
  const access = tenants.find((t) => t.tenant.id === tenantId);
  if (!access) throw new ForbiddenError("That workspace isn’t in your portfolio.");
  return { tenant: access.tenant, isAdmin: user.isPlatformAdmin };
}

const refresh = (tenant: TenantSummary) => {
  revalidatePath("/console");
  revalidatePath(`/console/${tenant.slug}`);
  revalidatePath(`/console/${tenant.slug}/settings`);
  revalidatePath(`/app/${tenant.slug}`);
};

const provisionSchema = z.object({
  templateKey: z.string().min(1),
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().max(48).optional(),
  region: z.string().trim().length(2),
  timezone: z.string().trim().min(3).max(64),
  locale: z.string().trim().min(2).max(16),
  currency: z.string().trim().length(3),
  fromName: z.string().trim().max(80).optional(),
  replyTo: z.string().trim().email().optional().or(z.literal("")),
  primaryColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional().or(z.literal("")),
  serviceAreas: z.string().trim().max(500).optional(),
  requiredFooter: z.string().trim().max(200).optional(),
});

/** Platform admin: create a workspace from a template. */
export async function provisionTenantAction(input: z.input<typeof provisionSchema>): Promise<ActionResult & { slug?: string }> {
  try {
    await adminOnly();
    const parsed = provisionSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "Check the name, region, timezone, locale and currency." };
    const d = parsed.data;
    if (!TEMPLATE_BY_KEY[d.templateKey]) return { ok: false, message: "Unknown template." };
    const tenant = await provisionTenant({ ...d, slug: d.slug || slugify(d.name), replyTo: d.replyTo || null, primaryColor: d.primaryColor || null, serviceAreas: (d.serviceAreas ?? "").split(",").map((s) => s.trim()).filter(Boolean), requiredFooter: d.requiredFooter || null });
    revalidatePath("/console");
    return { ok: true, message: `${tenant.name} is set up.`, slug: tenant.slug };
  } catch (error) {
    return fail(error);
  }
}

const settingsSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  fromName: z.string().trim().max(80).optional(),
  replyTo: z.string().trim().email().or(z.literal("")).optional(),
  primaryColor: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).or(z.literal("")).optional(),
  signAsAssignee: z.boolean().optional(),
  logoUrl: z.string().trim().url().or(z.literal("")).optional(),
  website: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(30).optional(),
  addresses: z.string().max(500).optional(),
  facebook: z.string().trim().url().or(z.literal("")).optional(),
  instagram: z.string().trim().url().or(z.literal("")).optional(),
  youtube: z.string().trim().url().or(z.literal("")).optional(),
  linkedin: z.string().trim().url().or(z.literal("")).optional(),
  firstResponseMinutes: z.number().int().min(1).max(1440).optional(),
  bookingWindowHours: z.number().int().min(1).max(720).optional(),
  quietStart: z.number().int().min(0).max(23).optional(),
  quietEnd: z.number().int().min(0).max(23).optional(),
  serviceAreas: z.string().max(500).optional(),
  greenCriteria: z.string().max(1000).optional(),
  autoHandled: z.string().max(1000).optional(),
  highIntentServices: z.string().max(500).optional(),
  requirePhone: z.boolean().optional(),
  voice: z.string().max(500).optional(),
  bannedPhrases: z.string().max(1000).optional(),
  requiredFooter: z.string().max(200).optional(),
  claimsPolicy: z.string().max(500).optional(),
});

const list = (s: string | undefined) => (s === undefined ? undefined : s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean));

/** Business, service levels, qualification and brand settings in one save. */
export async function saveTenantSettingsAction(tenantId: string, input: z.input<typeof settingsSchema>): Promise<ActionResult> {
  try {
    const { tenant } = await operatorTenant(tenantId);
    const parsed = settingsSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "Some values are out of range; check the numbers and the email address." };
    const d = parsed.data;
    const branding = { ...tenant.branding, ...(d.fromName !== undefined ? { fromName: d.fromName || undefined } : {}), ...(d.replyTo !== undefined ? { replyTo: d.replyTo || undefined } : {}), ...(d.primaryColor !== undefined ? { primaryColor: d.primaryColor || undefined } : {}), ...(d.signAsAssignee !== undefined ? { signAsAssignee: d.signAsAssignee } : {}), ...(d.requiredFooter !== undefined ? { footer: d.requiredFooter.trim() || undefined } : {}), ...(d.logoUrl !== undefined ? { logoUrl: d.logoUrl || undefined } : {}), ...(d.website !== undefined ? { website: d.website.replace(/^https?:\/\//i, "").replace(/\/$/, "") || undefined } : {}), ...(d.phone !== undefined ? { phone: d.phone || undefined } : {}), ...(d.addresses !== undefined ? { addresses: d.addresses.split(/\n/).map((a) => a.trim()).filter(Boolean) } : {}), ...(d.facebook !== undefined || d.instagram !== undefined || d.youtube !== undefined || d.linkedin !== undefined ? { social: { ...tenant.branding.social, ...(d.facebook !== undefined ? { facebook: d.facebook || undefined } : {}), ...(d.instagram !== undefined ? { instagram: d.instagram || undefined } : {}), ...(d.youtube !== undefined ? { youtube: d.youtube || undefined } : {}), ...(d.linkedin !== undefined ? { linkedin: d.linkedin || undefined } : {}) } } : {}) };
    const sla = { ...tenant.sla, ...(d.firstResponseMinutes ? { firstResponseMinutes: d.firstResponseMinutes } : {}), ...(d.bookingWindowHours ? { bookingWindowHours: d.bookingWindowHours } : {}), ...(d.quietStart !== undefined && d.quietEnd !== undefined ? { quietHours: { start: d.quietStart, end: d.quietEnd } } : {}) };
    const q = { ...tenant.qualificationRules };
    const areas = list(d.serviceAreas);
    if (areas) q.serviceAreas = areas;
    const green = list(d.greenCriteria);
    if (green) q.greenCriteria = green;
    const auto = list(d.autoHandled);
    if (auto) q.autoHandled = auto;
    const services = list(d.highIntentServices);
    if (services) q.highIntentServices = services;
    if (d.requirePhone !== undefined) q.requirePhone = d.requirePhone;
    await repository.updateTenant(tenantId, { ...(d.name ? { name: d.name } : {}), branding, sla, qualificationRules: q });
    if (d.voice !== undefined || d.bannedPhrases !== undefined || d.requiredFooter !== undefined || d.claimsPolicy !== undefined) {
      await repository.updateBrandProfile(tenantId, { ...(d.voice !== undefined ? { voice: d.voice || null } : {}), ...(d.bannedPhrases !== undefined ? { bannedPhrases: list(d.bannedPhrases) ?? [] } : {}), complianceBlock: { ...(d.requiredFooter !== undefined ? { requiredFooter: d.requiredFooter.trim() } : {}), ...(d.claimsPolicy !== undefined ? { claimsPolicy: d.claimsPolicy.trim() } : {}) } });
    }
    refresh(tenant);
    return { ok: true, message: "Settings saved." };
  } catch (error) {
    return fail(error);
  }
}

export async function setModuleAction(tenantId: string, moduleKey: string, enabled: boolean): Promise<ActionResult> {
  try {
    const { tenant } = await operatorTenant(tenantId);
    await repository.setModule(tenantId, moduleKey, { enabled });
    refresh(tenant);
    return { ok: true, message: `${moduleKey.replace(/_/g, " ")} ${enabled ? "on" : "off"}.` };
  } catch (error) {
    return fail(error);
  }
}

export async function setAutomationAction(tenantId: string, typeKey: string, enabled: boolean): Promise<ActionResult> {
  try {
    const { tenant } = await operatorTenant(tenantId);
    await repository.setAutomation(tenantId, typeKey, { enabled });
    refresh(tenant);
    return { ok: true, message: `${typeKey.replace(/_/g, " ")} ${enabled ? "on" : "off"}.` };
  } catch (error) {
    return fail(error);
  }
}

const OPPORTUNITY_TYPES: MissedOpportunityType[] = ["UNANSWERED_ENQUIRY", "MISSED_CALL", "ABANDONED_FORM", "NOT_BOOKED", "NO_SHOW", "QUIET_QUOTE", "UNREPLIED_DM", "UNREPLIED_COMMENT", "UNANSWERED_REVIEW", "LAPSED_CUSTOMER"];

/** Which missed-opportunity types escalate to a named client person. "*" means all of them. */
export async function saveEscalationRulesAction(tenantId: string, rules: { when: string; notifyUserId: string }[]): Promise<ActionResult> {
  try {
    const { tenant } = await operatorTenant(tenantId);
    const people = await repository.listTenantPeople(tenantId);
    const clean = rules.filter((r) => (r.when === "*" || OPPORTUNITY_TYPES.includes(r.when as MissedOpportunityType)) && people.some((p) => p.via === "member" && p.userId === r.notifyUserId)).slice(0, 20);
    await repository.updateTenant(tenantId, { escalationRules: clean });
    refresh(tenant);
    return { ok: true, message: `${clean.length} escalation rule${clean.length === 1 ? "" : "s"} saved.` };
  } catch (error) {
    return fail(error);
  }
}

export async function saveOpportunityValuesAction(tenantId: string, values: Record<string, number>): Promise<ActionResult> {
  try {
    const { tenant } = await operatorTenant(tenantId);
    const next = { ...tenant.opportunityValues };
    for (const [k, v] of Object.entries(values)) if (OPPORTUNITY_TYPES.includes(k as MissedOpportunityType) && Number.isFinite(v) && v >= 0) next[k as MissedOpportunityType] = Math.round(v * 100);
    await repository.updateTenant(tenantId, { opportunityValues: next });
    refresh(tenant);
    return { ok: true, message: "Values saved." };
  } catch (error) {
    return fail(error);
  }
}

const profileSchema = z.object({ title: z.string().trim().max(80).optional(), phone: z.string().trim().max(30).optional(), photoUrl: z.string().trim().url().or(z.literal("")).optional() });

/** Signature details for one member: job title, mobile and a hosted photo, used when messages are signed as them. */
export async function updateMemberProfileAction(tenantId: string, userId: string, input: z.input<typeof profileSchema>): Promise<ActionResult> {
  try {
    const { tenant } = await operatorTenant(tenantId);
    const parsed = profileSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "The photo must be a full https:// address; title and mobile are short text." };
    const person = (await repository.listTenantPeople(tenantId)).find((p) => p.userId === userId && p.via === "member");
    if (!person?.roleId) return { ok: false, message: "That person is not a member of this workspace." };
    const d = parsed.data;
    await repository.upsertMembership(tenantId, userId, person.roleId, { ...(d.title !== undefined ? { title: d.title || null } : {}), ...(d.phone !== undefined ? { phone: d.phone || null } : {}), ...(d.photoUrl !== undefined ? { photoUrl: d.photoUrl || null } : {}) });
    refresh(tenant);
    return { ok: true, message: `Signature details saved for ${person.name ?? person.email}.` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Could not save." };
  }
}

const inviteSchema = z.object({ email: z.string().trim().email(), name: z.string().trim().max(120).optional(), roleId: z.string().min(1), resetPassword: z.boolean().optional() });

/** Invite (or re-invite) a client person. Returns the one-time password once; it is never stored in clear. */
export async function inviteMemberAction(tenantId: string, input: z.input<typeof inviteSchema>): Promise<ActionResult & { temporaryPassword?: string | null }> {
  try {
    const { tenant } = await operatorTenant(tenantId);
    const parsed = inviteSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "A valid email and a role are needed." };
    const config = await repository.getTenantConfig(tenantId);
    if (!config.roles.some((r) => r.id === parsed.data.roleId)) return { ok: false, message: "Pick one of this workspace's roles." };
    const result = await inviteMember(tenantId, { email: parsed.data.email, name: parsed.data.name ?? null, roleId: parsed.data.roleId, resetPassword: parsed.data.resetPassword });
    await repository.recordAutomationRun(tenantId, { typeKey: "sla_watch", outcome: "COMPLETED", summary: `${result.user.name ?? result.user.email} was ${result.created ? "added to" : "updated in"} the workspace.` });
    refresh(tenant);
    return { ok: true, message: result.temporaryPassword ? `${result.user.email} can sign in with the one-time password below. Share it privately; it is shown once.` : `${result.user.email} now has that role.`, temporaryPassword: result.temporaryPassword };
  } catch (error) {
    return fail(error);
  }
}

export async function removeMemberAction(tenantId: string, userId: string): Promise<ActionResult> {
  try {
    const { tenant } = await operatorTenant(tenantId);
    await repository.removeMembership(tenantId, userId);
    refresh(tenant);
    return { ok: true, message: "Removed from the workspace." };
  } catch (error) {
    return fail(error);
  }
}

export async function assignOperatorAction(tenantId: string, userId: string): Promise<ActionResult> {
  try {
    await adminOnly();
    const { tenant } = await operatorTenant(tenantId);
    const operators = await repository.listOperators();
    if (!operators.some((o) => o.id === userId)) return { ok: false, message: "That person is not an operator." };
    await repository.assignOperator(tenantId, userId);
    refresh(tenant);
    return { ok: true, message: "Operator assigned." };
  } catch (error) {
    return fail(error);
  }
}

export async function issueApiKeyAction(tenantId: string, label: string, scopes: ApiKeyScope[]): Promise<ActionResult & { rawKey?: string }> {
  try {
    const { tenant } = await operatorTenant(tenantId);
    const clean = scopes.filter((s): s is ApiKeyScope => s === "intake" || s === "content");
    const issued = await issueApiKey(tenantId, label.slice(0, 80), clean);
    refresh(tenant);
    return { ok: true, message: `Key "${issued.key.label}" issued. Copy it now; it is shown once.`, rawKey: issued.raw };
  } catch (error) {
    return fail(error);
  }
}

export async function revokeApiKeyAction(tenantId: string, keyId: string): Promise<ActionResult> {
  try {
    const { tenant } = await operatorTenant(tenantId);
    await repository.revokeApiKey(tenantId, keyId);
    refresh(tenant);
    return { ok: true, message: "Key revoked." };
  } catch (error) {
    return fail(error);
  }
}

export async function importInventoryAction(tenantId: string, csv: string): Promise<ActionResult> {
  try {
    const { tenant } = await operatorTenant(tenantId);
    if (csv.length > 500_000) return { ok: false, message: "That file is too large; split it into parts under 500 KB." };
    const { items, skipped } = csvToInventory(csv);
    if (items.length === 0) return { ok: false, message: "No rows found. The first line must be a header with at least a name or address column." };
    const result = await importInventory(tenant, items);
    refresh(tenant);
    return { ok: true, message: `${result.created} new, ${result.updated} updated${skipped ? `, ${skipped} skipped` : ""}.` };
  } catch (error) {
    return fail(error);
  }
}
