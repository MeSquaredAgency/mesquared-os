/**
 * Drafts a workspace definition from a completed Me² Client Onboarding
 * Questionnaire. Export the client's doc as Markdown (Claude Docs: Export →
 * Markdown), then:
 *
 *   npm run tenant:from-questionnaire -- <questionnaire.md> [tenants/<slug>.json] [--force]
 *
 * Writes the draft (default `tenants/<slug>.json`, git-ignored) with a
 * `_review` list at the top: everything that could not be read and every step
 * the file cannot do. Work through it, delete `_review`, then provision:
 *
 *   npm run tenant:provision -- tenants/<slug>.json
 *
 * Nothing is sent anywhere and no database is touched. The draft holds the
 * client's contact details, so keep it under tenants/ and never commit it.
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { draftTenantDefinition, parseQuestionnaire } from "@/lib/onboarding/questionnaire";
import { tenantSettingsSchema } from "@/lib/tenants/settings";

const args = process.argv.slice(2);
const force = args.includes("--force");
const [input, output] = args.filter((a) => a !== "--force");
assert.ok(input, "usage: npm run tenant:from-questionnaire -- <questionnaire.md> [tenants/<slug>.json] [--force]");

const { definition, review } = draftTenantDefinition(parseQuestionnaire(readFileSync(input, "utf8")));
const checked = tenantSettingsSchema.safeParse(definition);
if (!checked.success) review.unshift(`Some settings are out of range and provisioning will refuse them: ${checked.error.issues.map((i) => `${i.path.join(".")} (${i.message})`).join("; ")}`);

const target = output ?? `tenants/${definition.slug || "new-client"}.json`;
assert.ok(force || !existsSync(target), `${target} already exists; pass --force to overwrite it`);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify({ _review: review, ...definition }, null, 2)}\n`);

console.log(`Drafted ${target} for "${definition.name || "(no name)"}" on the ${definition.templateKey} template, ${definition.people?.length ?? 0} people.`);
if (review.length) {
  console.log(`\nTo review before provisioning (${review.length}):`);
  for (const line of review) console.log(`  - ${line}`);
}
console.log(`\nThen: npm run tenant:provision -- ${target}`);
