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
  const iManager = col("manager", "property_manager", "agent");
  const iKind = col("property_type", "category", "kind");
  const iCar = col("car", "car_spaces", "parking", "garage");
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
    if (iManager >= 0 && r[iManager]) attributes.manager = r[iManager];
    if (iKind >= 0 && r[iKind]) attributes.propertyType = r[iKind];
    if (iCar >= 0 && r[iCar] && Number(r[iCar]) > 0) attributes.carSpaces = Number(r[iCar]);
    if (type === "LISTING" && !attributes.suburb) {
      const suburb = suburbFromAddress(name);
      if (suburb) attributes.suburb = suburb;
    }
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

/** "6B East Way, Darlington SA 5047" → "Darlington"; null when the address carries no suburb. */
export function suburbFromAddress(address: string): string | null {
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const tail = parts.slice(1).join(" ");
  const cleaned = tail.replace(/\b(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\b/gi, " ").replace(/\b\d{4}\b/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || null;
}

/** What an enquiry asks for, read with fixed patterns only: bedrooms as a number, nothing echoed from the text. */
export function listingNeeds(text: string | null | undefined): { bedrooms: number | null; rental: boolean; inspection: boolean } {
  const t = (text ?? "").toLowerCase();
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  const m = /\b(\d|one|two|three|four|five|six)\s*(?:-|\s)?\s*(?:bed(?:room)?s?|br\b)/.exec(t);
  const bedrooms = m ? (Number(m[1]) || words[m[1]] || null) : null;
  return { bedrooms, rental: /\b(rent|rental|rentals|lease|leasing|let)\b/.test(t), inspection: /\binspect/.test(t) };
}

/** Available listings that fit a suburb and bedroom count, best matches first, for a reply with real options in it. */
export async function findListingsMatching(tenantId: string, want: { suburb?: string | null; bedrooms?: number | null; limit?: number }): Promise<InventoryItemRecord[]> {
  if (!want.suburb && !want.bedrooms) return [];
  const items = await repository.listInventory(tenantId, { type: "LISTING", status: ["ACTIVE"], limit: 500 });
  const suburb = want.suburb?.toLowerCase() ?? null;
  // The suburb attribute decides; the name is only consulted for listings that never had one parsed, so a street
  // called "Darlington Rd" in another suburb is not offered as Darlington.
  const inSuburb = suburb ? items.filter((i) => (typeof i.attributes.suburb === "string" ? i.attributes.suburb.toLowerCase() === suburb : i.name.toLowerCase().includes(suburb))) : items;
  const beds = want.bedrooms ?? null;
  const exact = beds ? inSuburb.filter((i) => i.attributes.bedrooms === beds) : inSuburb;
  const pool = exact.length ? exact : beds ? inSuburb.filter((i) => typeof i.attributes.bedrooms === "number" && i.attributes.bedrooms > beds) : inSuburb;
  return (suburb ? pool : pool).slice(0, want.limit ?? 3);
}

const STREET_WORDS: Record<string, string> = { street: "st", road: "rd", avenue: "ave", av: "ave", terrace: "tce", drive: "dr", court: "ct", place: "pl", crescent: "cres", parade: "pde", boulevard: "bvd", highway: "hwy", lane: "ln", close: "cl", circuit: "cct", esplanade: "esp", grove: "gr", square: "sq", way: "way" };

/**
 * "12 Smith Street, Darlington SA 5047" and "12 smith st darlington" read as the
 * same thing: lower case, street words abbreviated, state and postcode and
 * punctuation dropped, spaces collapsed.
 */
export function normaliseAddress(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(act|nsw|nt|qld|sa|tas|vic|wa)\b/g, " ")
    .replace(/\b\d{4}\b/g, " ")
    .replace(/[^a-z0-9/]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => STREET_WORDS[w] ?? w)
    .join(" ");
}

/** The part of a listing name that identifies it: the street address before the first comma, normalised. */
function streetKey(name: string): string {
  return normaliseAddress(name.split(",")[0] ?? name);
}

/** A listing whose street address the enquiry mentions, however it was spelt, for the automatic reply. */
export async function findListingMentioned(tenantId: string, text: string | null | undefined): Promise<InventoryItemRecord | null> {
  if (!text) return null;
  const hay = ` ${normaliseAddress(text)} `;
  const items = await repository.listInventory(tenantId, { type: "LISTING", status: ["ACTIVE", "LOW"], limit: 500 });
  const mentions = (value: string) => {
    const key = streetKey(value);
    return key.length >= 6 && /\d/.test(key) && hay.includes(` ${key} `);
  };
  return items.find((i) => mentions(i.name)) ?? items.find((i) => typeof i.attributes.address === "string" && mentions(i.attributes.address as string)) ?? null;
}

export function describeListing(item: InventoryItemRecord, locale: string, currency: string): string {
  const a = item.attributes;
  const parts: string[] = [item.name];
  if (typeof a.suburb === "string" && !item.name.toLowerCase().includes(a.suburb.toLowerCase())) parts.push(a.suburb);
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
