/**
 * Imports listings or a rent roll from a CSV into a workspace, against
 * whatever DATABASE_URL points at. Same columns as Settings → Inventory:
 * address/name, suburb, bedrooms, bathrooms, car, property_type, manager,
 * status (available/leased/sold/...), rent, price, url, available_from, id.
 *
 *   npm run inventory:import -- <workspace-slug> <file.csv> [source]
 *
 * Idempotent: rows are matched by id when the file has one, else by name.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dataMode, repository } from "@/lib/data";
import { csvToInventory, importInventory } from "@/lib/inventory";

const [slug, file, source = "csv"] = process.argv.slice(2);
assert.ok(slug && file, "usage: npm run inventory:import -- <workspace-slug> <file.csv> [source]");
const tenant = await repository.findTenantBySlug(slug);
assert.ok(tenant, `no workspace with slug ${slug}`);
const { items, skipped } = csvToInventory(readFileSync(file, "utf8"));
console.log(`Importing ${items.length} rows into ${tenant.name} (${dataMode}); ${skipped} rows without a name skipped`);
const result = await importInventory(tenant, items, source);
const available = items.filter((i) => i.status === "ACTIVE").length;
console.log(`Done: ${result.created} new, ${result.updated} updated; ${available} marked available.`);
