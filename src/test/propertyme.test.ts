import assert from "node:assert/strict";
import { after, before, beforeEach, describe, it } from "node:test";
import { propertyMeProvider } from "@/lib/inventory/providers/propertyme";

/**
 * The PropertyMe adapter against a scripted API: paging, vacancy → status,
 * rent periods, the sales list being best effort, and the 401 → refresh path.
 */

const realFetch = globalThis.fetch;
let calls: { url: string; auth: string | null; body: string | null }[] = [];
let script: (url: URL, init?: RequestInit) => Response | Promise<Response>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const lot = (id: string, extra: Record<string, unknown> = {}) => ({ Id: id, Address: { Number: id.replace(/\D/g, "") || "1", Street: "Test St", Suburb: "Glenelg", State: "SA", PostalCode: "5045" }, Bedrooms: 3, Bathrooms: 1, ...extra });

before(() => {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const headers = new Headers(init?.headers);
    calls.push({ url: url.pathname + url.search, auth: headers.get("authorization"), body: init?.body ? String(init.body) : null });
    return script(url, init);
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  calls = [];
});

describe("PropertyMe adapter", () => {
  it("pages through the rent roll, marks the vacant lots available, and normalises rent to per week", async () => {
    const firstPage = Array.from({ length: 200 }, (_, i) => lot(`r${i}`, { RentAmount: 500, RentPeriod: "Week" }));
    const secondPage = [lot("r200", { AdRentAmount: 2600, AdRentPeriod: "Month" }), lot("r201", { RentAmount: 1000, RentPeriod: "Fortnight", Relet: true }), lot("r202", { IsArchived: true })];
    script = (url) => {
      if (url.pathname === "/api/v1/lots/rentals") return json(url.searchParams.get("Offset") === "0" ? firstPage : secondPage);
      if (url.pathname === "/api/v1/lots/vacancy") return json([lot("r200", { AdRentAmount: 2600, AdRentPeriod: "Month" })]);
      if (url.pathname === "/api/v1/lots/sales") return json([]);
      return json({ error: "nope" }, 404);
    };
    const result = await propertyMeProvider.fetchListings({ accessToken: "tok" }, { currency: "AUD" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const rentalCalls = calls.filter((c) => c.url.startsWith("/api/v1/lots/rentals"));
    assert.deepEqual(rentalCalls.map((c) => c.url), ["/api/v1/lots/rentals?Offset=0&Limit=200", "/api/v1/lots/rentals?Offset=200&Limit=200"], "a full page fetches the next; a short page ends the list");
    assert.ok(calls.every((c) => c.auth === "Bearer tok"));
    assert.equal(result.items.length, 203);
    const byId = new Map(result.items.map((i) => [i.externalId, i]));
    assert.equal(byId.get("r200")!.status, "ACTIVE", "vacant lot is available");
    assert.equal(byId.get("r200")!.attributes!.rentPerWeekCents, 60_000, "$2,600 a month is $600 a week");
    assert.equal(byId.get("r201")!.status, "LOW", "a relet in progress is 'low'");
    assert.equal(byId.get("r201")!.attributes!.rentPerWeekCents, 50_000, "$1,000 a fortnight is $500 a week");
    assert.equal(byId.get("r0")!.status, "UNAVAILABLE", "a tenanted lot is leased");
    assert.equal(byId.get("r0")!.attributes!.rentPerWeekCents, 50_000);
    assert.equal(byId.get("r202")!.status, "ARCHIVED");
    assert.equal(byId.get("r0")!.name, "0 Test St");
    assert.equal(byId.get("r0")!.attributes!.suburb, "Glenelg");
    assert.equal(byId.get("r0")!.source, "propertyme");
  });

  it("keeps going when the sales list fails, and refreshes an expired token once", async () => {
    let rentalAttempts = 0;
    script = (url) => {
      if (url.hostname === "login.propertyme.com") return json({ access_token: "fresh", refresh_token: "r2", expires_in: 3600 });
      if (url.pathname === "/api/v1/lots/rentals") {
        rentalAttempts++;
        return rentalAttempts === 1 ? json({ error: "expired" }, 401) : json([lot("a1")]);
      }
      if (url.pathname === "/api/v1/lots/vacancy") return json([]);
      if (url.pathname === "/api/v1/lots/sales") return json({ error: "boom" }, 500);
      return json({}, 404);
    };
    const result = await propertyMeProvider.fetchListings({ accessToken: "stale", refreshToken: "r1", clientId: "cid", clientSecret: "cs" }, { currency: "AUD" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const refresh = calls.find((c) => c.body?.includes("grant_type=refresh_token"));
    assert.ok(refresh, "the refresh endpoint was called");
    assert.match(refresh.body!, /refresh_token=r1/);
    assert.deepEqual(result.credentials && { accessToken: result.credentials.accessToken, refreshToken: result.credentials.refreshToken }, { accessToken: "fresh", refreshToken: "r2" }, "new credentials come back to be stored");
    assert.ok(calls.some((c) => c.url.startsWith("/api/v1/lots/rentals") && c.auth === "Bearer fresh"), "the retry used the new token");
    assert.deepEqual(result.items.map((i) => i.externalId), ["a1"], "rentals survive a failing sales list");
  });

  it("reports an expired token it cannot refresh instead of returning an empty rent roll", async () => {
    script = (url) => (url.pathname === "/api/v1/lots/vacancy" ? json([]) : json({ error: "expired" }, 401));
    const result = await propertyMeProvider.fetchListings({ accessToken: "stale" }, { currency: "AUD" });
    assert.equal(result.ok, false);
    assert.match(result.ok ? "" : result.error, /expired and could not be refreshed/);
  });
});
