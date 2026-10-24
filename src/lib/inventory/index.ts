import { generateFromSource, ingestSource } from "@/lib/content/engine";
import { repository } from "@/lib/data";
import type { NewInventoryItem } from "@/lib/data/repository";
import { emit, subscribe } from "@/lib/events";
import type { InventoryItemRecord, InventoryStatus, InventoryType, TenantSummary } from "@/lib/types";

/**
 * Inventory: whatever a business tracks (listings and rent roll, appointment
 * capacity, stock). Phase 5 ships the generic part: CSV import, a list in
 * both surfaces, and two hooks into the rest of the platform: a new listing
 * becomes content-engine material, and a renter's enquiry about a known
 * listing gets the listing's own link in the automatic reply.
 */

const STATUS_WORDS: Record<string, InventoryStatus> = {
  active: "ACTIVE",
  available: "ACTIVE",
  "for lease": "ACTIVE",
  "for sale": "ACTIVE",
  listed: "ACTIVE",
  low: "LOW",
  "under offer": "LOW",
  "application pending": "LOW",
  leased: "UNAVAILABLE",
  sold: "UNAVAILABLE",
  unavailable: "UNAVAILABLE",
  withdrawn: "ARCHIVED",
  archived: "ARCHIVED",
};

const toCents = (v: string | undefined): number | null => {
  if (!v) return null;
  const n = Number(v.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};

/** A forgiving CSV parser: quoted fields, commas inside quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f.trim())) rows.push(row.map((f) => f.trim()));
      row = [];
      field = "";
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row.map((f) => f.trim()));
  return rows;
}

/**
 * Columns are matched by header name, case-insensitively: name/address,
 * status, type, price, rent (per week), bedrooms, bathrooms, suburb, url,
 * available/available_from, id/reference/external_id, quantity.
 */
export function csvToInventory(text: string, defaultType: InventoryType = "LISTING"): { items: NewInventoryItem[]; skipped: number } {
  const rows = parseCsv(text);
  if (rows.length < 2) return { items: [], skipped: 0 };
  const header = rows[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const iName = col("name", "address", "property", "title", "item");
  const iStatus = col("status");
  const iType = col("type");
  const iPrice = col("price", "sale_price", "asking");
  const iRent = col("rent", "rent_per_week", "weekly_rent", "rent_pw");
  const iBeds = col("bedrooms", "beds", "bed");
  const iBaths = col("bathrooms", "baths", "bath");
  const iSuburb = col("suburb", "locality", "area");
  const iUrl = col("url", "link", "listing_url");
  const iAvail = col("available", "available_from", "availability");
  const iId = col("id", "reference", "external_id", "ref");
  const iQty = col("quantity", "qty", "stock");
  const items: NewInventoryItem[] = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const name = iName >= 0 ? r[iName] : r[0];
    if (!name) {
      skipped++;
      continue;
    }
    const typeWord = (iType >= 0 ? r[iType] : "").toUpperCase();
    const type: InventoryType = typeWord === "CAPACITY" || typeWord === "STOCK" ? typeWord : defaultType;
    const statusWord = (iStatus >= 0 ? r[iStatus] : "").toLowerCase();
    const attributes: Record<string, unknown> = {};
    const rentCents = toCents(iRent >= 0 ? r[iRent] : undefined);
    const priceCents = toCents(iPrice >= 0 ? r[iPrice] : undefined);
    if (rentCents) attributes.rentPerWeekCents = rentCents;
    if (priceCents) attributes.priceCents = priceCents;
    if (iBeds >= 0 && r[iBeds]) attributes.bedrooms = Number(r[iBeds]) || r[iBeds];
    if (iBaths >= 0 && r[iBaths]) attributes.bathrooms = Number(r[iBaths]) || r[iBaths];
    if (iSuburb >= 0 && r[iSuburb]) attributes.suburb = r[iSuburb];
    if (iUrl >= 0 && /^https?:\/\//i.test(r[iUrl] ?? "")) attributes.url = r[iUrl];
    if (iAvail >= 0 && r[iAvail]) attributes.availableFrom = r[iAvail];
    items.push({ type, name: name.slice(0, 200), externalId: iId >= 0 && r[iId] ? r[iId].slice(0, 100) : null, status: STATUS_WORDS[statusWord] ?? "ACTIVE", quantity: iQty >= 0 && r[iQty] ? Number(r[iQty]) || null : null, valueCents: priceCents ?? rentCents ?? null, attributes, source: "csv" });
  }
  return { items, skipped };
}

/** Imports items and announces the new ones, so the content engine can draft "just listed" posts when the tenant wants that. */
export async function importInventory(tenant: TenantSummary, items: NewInventoryItem[], source = "csv"): Promise<{ created: number; updated: number }> {
  const result = await repository.upsertInventoryItems(tenant.id, items.map((i) => ({ ...i, source: i.source ?? source })));
  for (const item of result.created) await emit(tenant.id, "inventory.item.created", { itemId: item.id, type: item.type, name: item.name, status: item.status });
  if (result.created.length || result.updated) await repository.recordAutomationRun(tenant.id, { typeKey: "content_engine", outcome: "COMPLETED", summary: `Inventory updated: ${result.created.length} new, ${result.updated} changed.` });
  return { created: result.created.length, updated: result.updated };
}

/** A listing whose name or address the enquiry mentions, for the automatic reply. */
export async function findListingMentioned(tenantId: string, text: string | null | undefined): Promise<InventoryItemRecord | null> {
  if (!text) return null;
  const hay = text.toLowerCase();
  const items = await repository.listInventory(tenantId, { type: "LISTING", status: ["ACTIVE", "LOW"], limit: 500 });
  return items.find((i) => i.name.length >= 6 && hay.includes(i.name.toLowerCase())) ?? items.find((i) => typeof i.attributes.address === "string" && (i.attributes.address as string).length >= 6 && hay.includes((i.attributes.address as string).toLowerCase())) ?? null;
}

export function describeListing(item: InventoryItemRecord, locale: string, currency: string): string {
  const a = item.attributes;
  const parts: string[] = [item.name];
  if (typeof a.suburb === "string") parts.push(a.suburb);
  if (typeof a.bedrooms === "number") parts.push(`${a.bedrooms} bed${a.bedrooms === 1 ? "" : "s"}`);
  if (typeof a.rentPerWeekCents === "number") parts.push(`${(a.rentPerWeekCents / 100).toLocaleString(locale, { style: "currency", currency, maximumFractionDigits: 0 })} per week`);
  else if (typeof a.priceCents === "number") parts.push((a.priceCents / 100).toLocaleString(locale, { style: "currency", currency, maximumFractionDigits: 0 }));
  if (typeof a.availableFrom === "string") parts.push(`available ${a.availableFrom}`);
  return parts.join(" · ");
}

let registered = false;

/** New listings become source material when the inventory module asks for it (settings.draftOnNew, default true for listings). */
export function registerInventory() {
  if (registered) return;
  registered = true;
  subscribe("inventory.item.created", async (e) => {
    if (e.payload.type !== "LISTING") return;
    const tenant = await repository.findTenantById(e.tenantId);
    if (!tenant) return;
    const cfg = await repository.getTenantConfig(tenant.id);
    const inventory = cfg.modules.find((m) => m.moduleKey === "inventory");
    if (!inventory?.enabled || inventory.settings.draftOnNew === false) return;
    const item = (await repository.listInventory(tenant.id, { type: "LISTING", limit: 500 })).find((i) => i.id === e.payload.itemId);
    if (!item || item.status !== "ACTIVE") return;
    const source = await ingestSource(tenant, { kind: "RAW_TEXT", title: `Just listed — ${item.name}`, body: `New listing: ${describeListing(item, tenant.locale, tenant.currency)}.${typeof item.attributes.url === "string" ? ` Details and inspection times: ${item.attributes.url}` : ""}`, origin: "operator", sourceRef: item.id });
    await generateFromSource(tenant, source.id);
  });
}
