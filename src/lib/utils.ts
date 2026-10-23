import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formatting context for a tenant: where they are and how they read numbers. */
export interface FormatContext {
  timezone: string;
  locale: string;
  currency: string;
}

export function formatMoney(cents: number, currency = "USD", locale = "en-AU") {
  return new Intl.NumberFormat(locale, { style: "currency", currency }).format(cents / 100);
}

/** e.g. "24 Oct, 3:05 pm" in the tenant's timezone. */
export function formatDateTime(date: Date | string, { timezone, locale }: Pick<FormatContext, "timezone" | "locale">) {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, { timeZone: timezone, day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(d);
}

/** e.g. "3:05 pm" in the tenant's timezone. */
export function formatTime(date: Date | string, { timezone, locale }: Pick<FormatContext, "timezone" | "locale">) {
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(d);
}

export function timeAgo(date: Date | string, now: Date = new Date()) {
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Math.max(0, now.getTime() - d.getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** "BOOKING_SENT" → "Booking sent" */
export function humanize(value: string) {
  const lower = value.toLowerCase().replace(/_/g, " ");
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Midnight at the start of "today" in the given IANA timezone, as a UTC
 * instant. Used so "today" stats follow the tenant's day, not the server's.
 */
export function startOfDayInZone(timeZone: string, now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Local wall-clock time in the zone, interpreted as if it were UTC…
  const localAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  // …so the difference to `now` is the zone offset at this instant.
  const offsetMs = localAsUtc - now.getTime();
  const localMidnightAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"));
  return new Date(localMidnightAsUtc - offsetMs);
}

/** Black or white, whichever reads better on the given hex background. */
export function readableTextOn(hex: string | undefined): "#000000" | "#ffffff" {
  if (!hex) return "#ffffff";
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = Number.parseInt(m[1], 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  return lum > 0.4 ? "#000000" : "#ffffff";
}

/**
 * Interprets a `datetime-local` string ("2026-01-15T14:05") as wall-clock
 * time in the given IANA timezone and returns the UTC instant. Returns null
 * for unparsable input.
 */
export function zonedLocalToUtc(local: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s || 0);
  // Offset of the zone at roughly that instant; a second pass handles DST edges.
  const offsetAt = (instant: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(instant));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - instant;
  };
  let guess = asUtc - offsetAt(asUtc);
  guess = asUtc - offsetAt(guess);
  return new Date(guess);
}

/** Formats a `datetime-local` string for display without any timezone shift. */
export function formatLocalInput(local: string, locale: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return local;
  const [, y, mo, d, h, mi] = m.map(Number);
  return new Intl.DateTimeFormat(locale, { timeZone: "UTC", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(
    new Date(Date.UTC(y, mo - 1, d, h, mi)),
  );
}

/** Midnight at the start of the current month in the given timezone, as a UTC instant. */
export function startOfMonthInZone(timeZone: string, now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const firstOfMonthLocal = `${get("year")}-${String(get("month")).padStart(2, "0")}-01T00:00`;
  return zonedLocalToUtc(firstOfMonthLocal, timeZone) ?? startOfDayInZone(timeZone, now);
}
