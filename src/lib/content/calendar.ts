import type { ContentAssetRecord, SocialPostRecord, TenantSummary } from "@/lib/types";
import { zonedLocalToUtc } from "@/lib/utils";

/**
 * The content calendar: posting slots in the tenant's week, the next free
 * slot for a newly approved asset, the gap between what is scheduled and the
 * cadence the tenant wants, and a day-by-day view for the two surfaces.
 *
 * Slots live on the `content` module settings:
 *   { slots: [{ day: 1, hour: 9 }, …], postsPerWeek: 3 }
 * day is 0–6 (Sunday–Saturday) in the tenant's timezone.
 */
export interface PostingSlot {
  day: number;
  hour: number;
  minute?: number;
}

export const DEFAULT_SLOTS: PostingSlot[] = [
  { day: 1, hour: 9 },
  { day: 3, hour: 9 },
  { day: 5, hour: 10 },
];

export function slotsFor(settings: Record<string, unknown> | undefined): PostingSlot[] {
  const raw = settings?.slots;
  if (!Array.isArray(raw)) return DEFAULT_SLOTS;
  const slots = raw.filter((s): s is PostingSlot => typeof s === "object" && s !== null && typeof (s as PostingSlot).day === "number" && typeof (s as PostingSlot).hour === "number");
  return slots.length ? slots : DEFAULT_SLOTS;
}

export function cadenceTarget(settings: Record<string, unknown> | undefined): number {
  const n = settings?.postsPerWeek;
  return typeof n === "number" && n > 0 ? Math.min(21, Math.round(n)) : 3;
}

/** Local calendar parts for an instant in the tenant's timezone. */
function localParts(tz: string, at: Date): { y: number; m: number; d: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), weekday };
}

/** Midnight (local) of the day `offset` days after the local day containing `from`, as a UTC instant. */
function localDayStart(tz: string, from: Date, offset: number): Date {
  const { y, m, d } = localParts(tz, from);
  const base = new Date(Date.UTC(y, m - 1, d + offset));
  const iso = `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}-${String(base.getUTCDate()).padStart(2, "0")}`;
  return zonedLocalToUtc(`${iso}T00:00`, tz) ?? base;
}

/** The next `count` slot instants after `from`, in order. */
export function upcomingSlots(tenant: Pick<TenantSummary, "timezone">, slots: PostingSlot[], from: Date, count: number): Date[] {
  const out: Date[] = [];
  for (let offset = 0; offset < 60 && out.length < count; offset++) {
    const dayStart = localDayStart(tenant.timezone, from, offset);
    const { weekday } = localParts(tenant.timezone, new Date(dayStart.getTime() + 12 * 3_600_000));
    const { y, m, d } = localParts(tenant.timezone, new Date(dayStart.getTime() + 12 * 3_600_000));
    for (const slot of slots.filter((s) => s.day === weekday).sort((a, b) => a.hour - b.hour)) {
      const at = zonedLocalToUtc(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(slot.hour).padStart(2, "0")}:${String(slot.minute ?? 0).padStart(2, "0")}`, tenant.timezone);
      if (at && at.getTime() > from.getTime()) out.push(at);
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime()).slice(0, count);
}

/** The first upcoming slot not already taken (within 30 minutes) by one of `taken`. */
export function nextFreeSlot(tenant: Pick<TenantSummary, "timezone">, slots: PostingSlot[], taken: Date[], from = new Date()): Date {
  const candidates = upcomingSlots(tenant, slots, from, 40);
  const busy = taken.map((t) => t.getTime());
  const free = candidates.find((c) => !busy.some((b) => Math.abs(b - c.getTime()) < 30 * 60_000));
  // Every slot for weeks ahead is full: go an hour after the last one rather than refuse.
  return free ?? new Date((candidates.at(-1)?.getTime() ?? from.getTime()) + 3_600_000);
}

export interface CalendarDay {
  /** YYYY-MM-DD in the tenant's timezone. */
  date: string;
  weekday: number;
  isToday: boolean;
  posts: SocialPostRecord[];
  /** Approved drafts with a date but no post yet. */
  drafts: ContentAssetRecord[];
}

export function buildCalendar(tenant: Pick<TenantSummary, "timezone">, posts: SocialPostRecord[], assets: ContentAssetRecord[], from = new Date(), days = 14): CalendarDay[] {
  const out: CalendarDay[] = [];
  const todayKey = localKey(tenant.timezone, from);
  const postIdsWithAssets = new Set(posts.map((p) => p.contentAssetId).filter(Boolean));
  for (let offset = 0; offset < days; offset++) {
    const start = localDayStart(tenant.timezone, from, offset);
    const end = localDayStart(tenant.timezone, from, offset + 1);
    const inDay = (d: Date | null) => d !== null && d.getTime() >= start.getTime() && d.getTime() < end.getTime();
    const key = localKey(tenant.timezone, new Date(start.getTime() + 12 * 3_600_000));
    out.push({
      date: key,
      weekday: localParts(tenant.timezone, new Date(start.getTime() + 12 * 3_600_000)).weekday,
      isToday: key === todayKey,
      posts: posts.filter((p) => inDay(p.scheduledFor ?? p.publishedAt)).sort((a, b) => (a.scheduledFor?.getTime() ?? 0) - (b.scheduledFor?.getTime() ?? 0)),
      drafts: assets.filter((a) => a.scheduledFor && inDay(a.scheduledFor) && !postIdsWithAssets.has(a.id)),
    });
  }
  return out;
}

export function localKey(tz: string, at: Date): string {
  const { y, m, d } = localParts(tz, at);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export interface CalendarGap {
  /** Posts scheduled or published in the next 7 days. */
  scheduled: number;
  target: number;
  short: number;
}

/** How far the next seven days fall short of the tenant's cadence. */
export function calendarGap(posts: SocialPostRecord[], settings: Record<string, unknown> | undefined, now = new Date()): CalendarGap {
  const end = new Date(now.getTime() + 7 * 86_400_000);
  const scheduled = posts.filter((p) => p.scheduledFor && p.scheduledFor >= now && p.scheduledFor < end && (p.status === "SCHEDULED" || p.status === "APPROVED" || p.status === "PUBLISHING" || p.status === "PUBLISHED")).length;
  const target = cadenceTarget(settings);
  return { scheduled, target, short: Math.max(0, target - scheduled) };
}
