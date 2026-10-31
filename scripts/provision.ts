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
 *   "admins": [{ "email": "ops@...", "name": "..." }],
 *   "sla": { "firstResponseMinutes": 5, "bookingWindowHours": 48, "quietHours": { "start": 20, "end": 8 } },
 *   "qualification": { "greenCriteria": ["..."], "highIntentServices": ["..."], "autoHandled": ["..."], "requirePhone": true },
 *   "brand": { "voice": "...", "examples": ["..."], "bannedPhrases": ["..."], "claimsPolicy": "..." },
 *   "opportunityValues": { "NOT_BOOKED": 1800 },
 *   "content": { "postsPerWeek": 3, "slots": [{ "day": 1, "hour": 9 }] },
 *   "reviewUrl": "https://g.page/r/...", "switchOff": { "modules": ["inventory"], "automations": ["reactivation"] },
 *   "escalation": [{ "when": "NOT_BOOKED", "email": "..." }]
 * }
 *
 * The keys from "sla" down are optional business settings (src/lib/tenants/settings.ts);
 * opportunity values are whole currency units. `npm run tenant:from-questionnaire`
 * drafts the whole file from a completed onboarding questionnaire.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hashPassword } from "@/lib/auth/password";
import { dataMode, repository } from "@/lib/data";
import { readinessSummary, tenantReadiness } from "@/lib/launch/readiness";
import { applyDefinition, definitionProblems, type TenantDefinition } from "@/lib/tenants/definition";

interface Definition extends TenantDefinition {
  operators?: string[];
  admins?: { email: string; name: string }[];
}

const file = process.argv[2];
assert.ok(file, "usage: npm run tenant:provision -- tenants/<slug>.json");
const def = JSON.parse(readFileSync(file, "utf8")) as Definition;
// Check the whole definition before anything is created, so a typo never leaves a half-made workspace.
const problems = definitionProblems(def);
assert.ok(problems.length === 0, `the definition has problems: ${problems.join("; ")}`);
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

// 2. The workspace, its SMS number, people and business settings (src/lib/tenants/definition.ts).
const { tenant, log } = await applyDefinition(def, { refresh: true });
for (const line of log) console.log(`  ${line}`);

// 3. Operators.
for (const email of def.operators ?? []) {
  const found = await repository.findUserByEmail(email.toLowerCase());
  assert.ok(found, `operator ${email} does not exist; list them under "admins" or create them first`);
  if (!found.user.isOperator) await repository.setUserFlags(found.user.id, { isOperator: true });
  await repository.assignOperator(tenant.id, found.user.id);
  console.log(`  operator ${email} assigned`);
}

const summary = readinessSummary(await tenantReadiness(tenant));
console.log(`\nDone. Launch readiness: ${summary.requiredPassed} of ${summary.requiredTotal} required checks pass. Open /console/${tenant.slug}/settings for the rest.`);
