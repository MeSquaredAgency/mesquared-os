import type { NewInventoryItem } from "@/lib/data/repository";
import { propertyMeProvider } from "./propertyme";

/**
 * Inventory providers pull listings and rent rolls from the client's property
 * management software into the inventory table. Like the ads and finance
 * adapters: one adapter per vendor behind one interface, and INVENTORY_MODE=log
 * swaps in a simulator so every flow runs without credentials.
 */

export interface InventoryCredentials {
  accessToken: string;
  refreshToken?: string;
  /** OAuth client used to refresh the token; without it an expired token is reported, not refreshed. */
  clientId?: string;
  clientSecret?: string;
  /** ISO time the access token expires, when the vendor says. */
  expiresAt?: string;
}

export type InventoryFetchResult = { ok: true; items: NewInventoryItem[]; credentials?: InventoryCredentials; note?: string } | { ok: false; error: string; credentials?: InventoryCredentials };

export interface InventoryProvider {
  name: string;
  fetchListings(creds: InventoryCredentials, opts: { currency: string }): Promise<InventoryFetchResult>;
}

/** Two sample lots so the sync, the content hook and the listing-aware reply can be exercised without a vendor account. */
export const logInventoryProvider: InventoryProvider = {
  name: "log",
  async fetchListings() {
    return {
      ok: true,
      note: "simulated",
      items: [
        { type: "LISTING", externalId: "log-lot-1", name: "7 Harbour View Terrace", status: "ACTIVE", valueCents: 65_000, attributes: { suburb: "Glenelg", bedrooms: 3, bathrooms: 2, carSpaces: 1, rentPerWeekCents: 65_000, availableFrom: "now", url: "https://example.com/listings/log-lot-1" }, source: "propertyme" },
        { type: "LISTING", externalId: "log-lot-2", name: "22/4 Station Road", status: "UNAVAILABLE", valueCents: 48_000, attributes: { suburb: "Blair Athol", bedrooms: 2, bathrooms: 1, rentPerWeekCents: 48_000, leased: true }, source: "propertyme" },
      ],
    };
  },
};

const registry = new Map<string, InventoryProvider>([["propertyme", propertyMeProvider]]);

export const INVENTORY_VENDORS = ["propertyme"] as const;
export type InventoryVendor = (typeof INVENTORY_VENDORS)[number];

export function inventoryProviderFor(vendor: string): InventoryProvider {
  if (process.env.INVENTORY_MODE === "log") return logInventoryProvider;
  return registry.get(vendor.toLowerCase()) ?? logInventoryProvider;
}

export function hasRealInventoryProvider(vendor: string): boolean {
  return process.env.INVENTORY_MODE !== "log" && registry.has(vendor.toLowerCase());
}
