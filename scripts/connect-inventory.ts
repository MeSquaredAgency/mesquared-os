/**
 * Connects a workspace to its property management software so the daily
 * inventory sync keeps the rent roll current, against whatever DATABASE_URL
 * points at. The token is read from an environment variable, never from the
 * command line, so it stays out of shell history:
 *
 *   PROPERTYME_TOKEN=... npm run tenant:connect-inventory -- <workspace-slug> propertyme PROPERTYME_TOKEN
 *
 * Re-running replaces the stored (encrypted) credentials. The first sync runs
 * on the next daily job, or sooner with INVENTORY sync from the console.
 */
import assert from "node:assert/strict";
import { dataMode, repository } from "@/lib/data";
import { connectInventoryVendor } from "@/lib/inventory/sync";

const [slug, vendor, tokenVar] = process.argv.slice(2);
assert.ok(slug && vendor && tokenVar, "usage: npm run tenant:connect-inventory -- <workspace-slug> propertyme <ENV_VAR_HOLDING_THE_TOKEN>");
assert.equal(vendor, "propertyme", `unsupported vendor ${vendor}; only propertyme is implemented`);
const token = process.env[tokenVar];
assert.ok(token, `environment variable ${tokenVar} is empty`);
const tenant = await repository.findTenantBySlug(slug);
assert.ok(tenant, `no workspace with slug ${slug}`);
await connectInventoryVendor(tenant.id, "propertyme", { accessToken: token }, { label: "PropertyMe" });
console.log(`Connected ${tenant.name} to PropertyMe (${dataMode}). The rent roll syncs daily; run the sync from the console to pull it now.`);
