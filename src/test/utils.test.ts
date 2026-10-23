import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { safeNext } from "@/lib/auth/redirect";
import { formatDateTime, formatMoney, humanize, readableTextOn, startOfDayInZone, timeAgo } from "@/lib/utils";

describe("safeNext", () => {
  it("allows same-origin paths and rejects everything else", () => {
    assert.equal(safeNext("/feed?x=1"), "/feed?x=1");
    assert.equal(safeNext("//evil.example"), "/dashboard");
    assert.equal(safeNext("https://evil.example"), "/dashboard");
    assert.equal(safeNext("/\\evil.example"), "/dashboard");
    assert.equal(safeNext("/login?next=/x"), "/dashboard");
    assert.equal(safeNext(undefined), "/dashboard");
    assert.equal(safeNext("/a\r\nSet-Cookie: x"), "/dashboard");
  });
});

describe("formatting helpers", () => {
  it("formats money in the tenant locale and currency", () => {
    assert.equal(formatMoney(123456, "AUD", "en-AU"), "$1,234.56");
    assert.equal(formatMoney(123456, "USD", "en-US"), "$1,234.56");
    assert.equal(formatMoney(-8000, "AUD", "en-AU"), "-$80.00");
  });

  it("formats dates in the tenant timezone", () => {
    const instant = new Date("2026-01-15T03:05:00Z"); // 14:05 in Sydney, 22:05 previous day in New York
    assert.match(formatDateTime(instant, { timezone: "Australia/Sydney", locale: "en-AU" }), /15 Jan.*2:05/);
    assert.match(formatDateTime(instant, { timezone: "America/New_York", locale: "en-US" }), /Jan 14.*10:05/);
  });

  it("computes start of day in a zone", () => {
    const now = new Date("2026-01-15T03:05:00Z");
    // Sydney is UTC+11 in January: local 14:05 on 15 Jan → midnight is 13:00Z on 14 Jan
    assert.equal(startOfDayInZone("Australia/Sydney", now).toISOString(), "2026-01-14T13:00:00.000Z");
    // New York is UTC-5: local 22:05 on 14 Jan → midnight is 05:00Z on 14 Jan
    assert.equal(startOfDayInZone("America/New_York", now).toISOString(), "2026-01-14T05:00:00.000Z");
    assert.equal(startOfDayInZone("UTC", now).toISOString(), "2026-01-15T00:00:00.000Z");
  });

  it("humanizes enums and relative times", () => {
    assert.equal(humanize("BOOKING_SENT"), "Booking sent");
    const now = new Date("2026-01-15T03:05:00Z");
    assert.equal(timeAgo(new Date("2026-01-15T03:04:30Z"), now), "just now");
    assert.equal(timeAgo(new Date("2026-01-15T02:05:00Z"), now), "1h ago");
    assert.equal(timeAgo(new Date("2026-01-13T03:05:00Z"), now), "2d ago");
  });

  it("picks a readable foreground for brand colours", () => {
    assert.equal(readableTextOn("#0f766e"), "#ffffff");
    assert.equal(readableTextOn("#fde68a"), "#000000");
    assert.equal(readableTextOn("not-a-colour"), "#ffffff");
  });
});
