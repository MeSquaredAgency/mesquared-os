/**
 * Provisions (or updates) one workspace from a JSON definition, against
 * whatever DATABASE_URL points at. Idempotent: run it again to apply changes.
 *
 *   npm run tenant:provision -- tenants/<slug>.json
 *
 * The definition holds no secrets. People are created with a random password
 * that is never printed; an operator resets it from Settings → People and hands
 * the one-time password over privately. Platform admins created here get the
 * password in SEED_OPERATOR_PASSWORD (required only when an admin is new).
 *
 * {
 *   "templateKey": "real_estate", "name": "...", "slug": "...",
 *   "region": "AU", "timezone": "Australia/Adelaide", "locale": "en-AU", "currency": "AUD",
 *   "fromName": "...", "replyTo": "...", "primaryColor": "#rrggbb", "serviceAreas": ["..."],
 *   "requiredFooter": "...", "signAsAssignee": true, "smsNumber": "+614...",
 *   "logoUrl": "https://...", "website": "example.com.au", "phone": "1300 ...",
 *   "addresses": ["Adelaide: ..."], "social": { "facebook": "https://...", "instagram": "https://..." },
 *   "people": [{ "email": "...", "name": "...", "role": "owner", "title": "Director", "mobile": "04..", "photo": "https://..." }],
 *   "operators": ["ops@..."],
 *   "admins": [{ "email": "ops@...", "name": "..." }]
 * }
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hashPassword } from "@/lib/auth/password";
import { dataMode, repository } from "@/lib/data";
import { readinessSummary, tenantReadiness } from "@/lib/launch/readiness";
import { normalizePhone } from "@/lib/intake/schema";
import { TEMPLATE_BY_KEY } from "@/lib/templates";
import { inviteMember, provisionTenant, slugify } from "@/lib/tenants/provision";

interface Definition {
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
  operators?: string[];
  admins?: { email: string; name: string }[];
}

const file = process.argv[2];
assert.ok(file, "usage: npm run tenant:provision -- tenants/<slug>.json");
const def = JSON.parse(readFileSync(file, "utf8")) as Definition;
const template = TEMPLATE_BY_KEY[def.templateKey];
assert.ok(template, `unknown template ${def.templateKey}`);
console.log(`Provisioning "${def.name}" against the ${dataMode} repository`);

// 1. Platform admins (also operators), created only with a known password.
for (const admin of def.admins ?? []) {
  const email = admin.email.toLowerCase();
  const found = await repository.findUserByEmail(email);
  if (found) {
    await repository.setUserFlags(found.user.id, { isOperator: true, isPlatformAdmin: true });
    console.log(`  admin    ${email} (existing; flags confirmed)`);
  } else {
    assert.ok(process.env.SEED_OPERATOR_PASSWORD, `SEED_OPERATOR_PASSWORD is needed to create the admin ${email}`);
    await repository.createUser({ email, name: admin.name, passwordHash: await hashPassword(process.env.SEED_OPERATOR_PASSWORD), isOperator: true, isPlatformAdmin: true });
    console.log(`  admin    ${email} (created; signs in with SEED_OPERATOR_PASSWORD)`);
  }
}

// 2. The workspace: created from the template, or its settings refreshed.
const slug = slugify(def.slug || def.name);
let tenant = await repository.findTenantBySlug(slug);
if (!tenant) {
  tenant = await provisionTenant({ templateKey: def.templateKey, name: def.name, slug, region: def.region, timezone: def.timezone, locale: def.locale, currency: def.currency, fromName: def.fromName ?? null, replyTo: def.replyTo ?? null, primaryColor: def.primaryColor ?? null, serviceAreas: def.serviceAreas ?? [], requiredFooter: def.requiredFooter ?? null });
  console.log(`  tenant   ${tenant.slug} created from the ${template.name} template`);
} else {
  console.log(`  tenant   ${tenant.slug} exists; refreshing settings`);
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

// 2b. The workspace's SMS number: texts go out from it and replies to it are
// routed back to this workspace (Twilio credentials stay in the deployment).
if (def.smsNumber) {
  const number = normalizePhone(def.smsNumber);
  assert.ok(number && number.startsWith("+"), `smsNumber must be in E.164 form (+614...), got ${def.smsNumber}`);
  await repository.upsertIntegration(tenant.id, { provider: "TWILIO", externalAccountId: number, label: "SMS", status: "CONNECTED", settings: { fromNumber: number } });
  console.log(`  sms      ${number} attached`);
}

// 3. People by template role key.
const config = await repository.getTenantConfig(tenant.id);
for (const person of def.people ?? []) {
  const roleDef = template.roles.find((r) => r.key === person.role);
  assert.ok(roleDef, `role "${person.role}" is not in the ${template.name} template`);
  const role = config.roles.find((r) => r.name === roleDef.name);
  assert.ok(role, `role "${roleDef.name}" missing on the tenant; re-apply the template`);
  const result = await inviteMember(tenant.id, { email: person.email, name: person.name, roleId: role.id, profile: { title: person.title ?? null, phone: person.mobile ?? null, photoUrl: person.photo ?? null } });
  console.log(`  person   ${person.email} → ${role.name}${result.created ? " (created; reset the password from Settings → People to hand it over)" : ""}`);
}

// 4. Operators.
for (const email of def.operators ?? []) {
  const found = await repository.findUserByEmail(email.toLowerCase());
  assert.ok(found, `operator ${email} does not exist; list them under "admins" or create them first`);
  if (!found.user.isOperator) await repository.setUserFlags(found.user.id, { isOperator: true });
  await repository.assignOperator(tenant.id, found.user.id);
  console.log(`  operator ${email} assigned`);
}

const summary = readinessSummary(await tenantReadiness(tenant));
console.log(`\nDone. Launch readiness: ${summary.requiredPassed} of ${summary.requiredTotal} required checks pass. Open /console/${tenant.slug}/settings for the rest.`);
