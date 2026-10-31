import type { NewInventoryItem } from "@/lib/data/repository";
import type { InventoryStatus } from "@/lib/types";
import type { InventoryCredentials, InventoryFetchResult, InventoryProvider } from "./index";

/**
 * PropertyMe (app.propertyme.com) read-only adapter: the rent roll and the
 * vacant rentals become LISTING inventory items. Written against the public
 * OpenAPI document at https://app.propertyme.com/api/openapi (Bearer token in
 * the Authorization header, OAuth 2.0 at login.propertyme.com with the
 * `property:read` and `offline_access` scopes).
 *
 * Untested against a live portfolio. Verify before connecting a real account:
 *   - GET /v1/lots/rentals?Offset&Limit paging (assumed: a page shorter than Limit ends the list)
 *   - GET /v1/lots/vacancy?RentalOnly=true marks the vacant rentals; everything else on the rent roll is "leased"
 *   - GET /v1/lots/sales is read best-effort; the price field name is unconfirmed (AskingPrice / ListPrice / Price are tried)
 *   - AdRentAmount + AdRentPeriod are the advertised rent; RentAmount + RentPeriod the current tenancy's. Periods are normalised to per week.
 *   - the refresh call: POST https://login.propertyme.com/connect/token with grant_type=refresh_token (client id + secret as form fields)
 */

const API = "https://app.propertyme.com/api";
const TOKEN_URL = "https://login.propertyme.com/connect/token";
const PAGE = 200;

interface Lot {
  Id?: string;
  Reference?: string;
  AddressText?: string;
  Address?: { Unit?: string; Number?: string; Street?: string; Suburb?: string; State?: string; PostalCode?: string; Text?: string };
  Bedrooms?: number;
  Bathrooms?: number;
  CarSpaces?: number;
  Description?: string;
  AdRentAmount?: number;
  AdRentPeriod?: string;
  RentAmount?: number;
  RentPeriod?: string;
  IsRental?: boolean;
  IsArchived?: boolean;
  ArchivedOn?: string | null;
  UpdatedOn?: string;
  TenancyEnd?: string | null;
  Relet?: boolean;
  ExternalListingUrl?: string;
  ExternalListingId?: string;
  AskingPrice?: number;
  ListPrice?: number;
  Price?: number;
  [key: string]: unknown;
}

const perWeekCents = (amount: number | undefined, period: string | undefined): number | null => {
  if (!amount || amount <= 0) return null;
  const p = (period ?? "week").toLowerCase();
  const weekly = p.includes("fortnight") ? amount / 2 : p.includes("month") ? (amount * 12) / 52 : p.includes("year") || p.includes("annual") ? amount / 52 : amount;
  return Math.round(weekly * 100);
};

function lotName(lot: Lot): string {
  const a = lot.Address;
  const composed = a ? [a.Unit ? `${a.Unit}/` : "", a.Number ?? "", " ", a.Street ?? ""].join("").trim() : "";
  return (lot.AddressText || a?.Text || composed || lot.Reference || lot.Id || "Property").trim().slice(0, 200);
}

function toItem(lot: Lot, status: InventoryStatus, kind: "rental" | "sale"): NewInventoryItem | null {
  if (!lot.Id) return null;
  const rent = perWeekCents(lot.AdRentAmount, lot.AdRentPeriod) ?? perWeekCents(lot.RentAmount, lot.RentPeriod);
  const price = kind === "sale" ? [lot.AskingPrice, lot.ListPrice, lot.Price].find((v): v is number => typeof v === "number" && v > 0) : undefined;
  const attributes: Record<string, unknown> = { kind, reference: lot.Reference ?? null, suburb: lot.Address?.Suburb ?? null, state: lot.Address?.State ?? null, postcode: lot.Address?.PostalCode ?? null, address: lotName(lot) };
  if (typeof lot.Bedrooms === "number") attributes.bedrooms = lot.Bedrooms;
  if (typeof lot.Bathrooms === "number") attributes.bathrooms = lot.Bathrooms;
  if (typeof lot.CarSpaces === "number") attributes.carSpaces = lot.CarSpaces;
  if (rent) attributes.rentPerWeekCents = rent;
  if (price) attributes.priceCents = Math.round(price * 100);
  if (typeof lot.ExternalListingUrl === "string" && /^https?:\/\//i.test(lot.ExternalListingUrl)) attributes.url = lot.ExternalListingUrl;
  if (lot.Description) attributes.description = String(lot.Description).slice(0, 2000);
  if (lot.TenancyEnd) attributes.availableFrom = String(lot.TenancyEnd).slice(0, 10);
  return { type: "LISTING", externalId: lot.Id, name: lotName(lot), status, valueCents: (kind === "sale" ? attributes.priceCents : rent) as number | null, attributes, source: "propertyme" };
}

async function refresh(creds: InventoryCredentials): Promise<InventoryCredentials | null> {
  if (!creds.refreshToken || !creds.clientId || !creds.clientSecret) return null;
  const res = await fetch(TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: creds.refreshToken, client_id: creds.clientId, client_secret: creds.clientSecret }) });
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!json.access_token) return null;
  return { ...creds, accessToken: json.access_token, refreshToken: json.refresh_token ?? creds.refreshToken, expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000).toISOString() : creds.expiresAt };
}

export const propertyMeProvider: InventoryProvider = {
  name: "propertyme",
  async fetchListings(initial): Promise<InventoryFetchResult> {
    let creds = initial;
    let refreshed: InventoryCredentials | undefined;
    // One refresh per sync, shared by every request that saw the 401: the lists are read in
    // parallel, and PropertyMe's refresh tokens are single use, so a second refresh would fail.
    let refreshing: Promise<InventoryCredentials | null> | undefined;
    const get = async <T,>(path: string): Promise<T> => {
      const call = (token: string) => fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
      const sent = creds.accessToken;
      let res = await call(sent);
      if (res.status === 401) {
        refreshing ??= refresh(creds).then((next) => {
          if (next) creds = refreshed = next;
          return next;
        });
        const next = await refreshing;
        if (!next) throw new Error("PropertyMe token expired and could not be refreshed; reconnect the integration.");
        if (next.accessToken !== sent) res = await call(next.accessToken);
      }
      if (!res.ok) throw new Error(`PropertyMe ${path} returned ${res.status}`);
      return (await res.json()) as T;
    };
    const page = async (path: string, extra = ""): Promise<Lot[]> => {
      const all: Lot[] = [];
      for (let offset = 0; offset < 20_000; offset += PAGE) {
        const chunk = await get<Lot[]>(`${path}?Offset=${offset}&Limit=${PAGE}${extra}`);
        if (!Array.isArray(chunk)) break;
        all.push(...chunk);
        if (chunk.length < PAGE) break;
      }
      return all;
    };
    try {
      const [rentals, vacant] = await Promise.all([page("/v1/lots/rentals"), page("/v1/lots/vacancy", "&RentalOnly=true")]);
      const vacantIds = new Set(vacant.map((l) => l.Id).filter(Boolean));
      const items: NewInventoryItem[] = [];
      const seen = new Set<string>();
      for (const lot of [...vacant, ...rentals]) {
        if (!lot.Id || seen.has(lot.Id)) continue;
        seen.add(lot.Id);
        const status: InventoryStatus = lot.IsArchived || lot.ArchivedOn ? "ARCHIVED" : vacantIds.has(lot.Id) ? "ACTIVE" : lot.Relet || lot.TenancyEnd ? "LOW" : "UNAVAILABLE";
        const item = toItem(lot, status, "rental");
        if (item) items.push(item);
      }
      try {
        for (const lot of await page("/v1/lots/sales")) {
          if (!lot.Id || seen.has(lot.Id)) continue;
          seen.add(lot.Id);
          const item = toItem(lot, "ACTIVE", "sale");
          if (item) items.push(item);
        }
      } catch (error) {
        console.warn(`[inventory] PropertyMe sales list skipped: ${error instanceof Error ? error.message : error}`);
      }
      return { ok: true, items, credentials: refreshed };
    } catch (error) {
      // A refresh may have rotated the tokens before the failure; they must still be stored.
      return { ok: false, error: error instanceof Error ? error.message : String(error), credentials: refreshed };
    }
  },
};
