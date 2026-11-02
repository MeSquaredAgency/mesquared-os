import { normalizePhone, toE164 } from "@/lib/intake/schema";
import type { TenantSummary } from "@/lib/types";
import { zonedLocalToUtc } from "@/lib/utils";
import type { OutboundChannel } from "./types";

/**
 * Region rules for automated outbound messages. Kept deliberately small and
 * explicit; add a region when a tenant lands there.
 *
 * - defaultChannel: what to try first when the contact has a phone number.
 * - requiresConsentFor: channels that need recorded consent before a
 *   non-transactional message. Acknowledging an enquiry the person just sent
 *   is transactional everywhere.
 * - quietHours: local hours between which marketing messages are held.
 */
interface RegionRule {
  defaultChannel: OutboundChannel;
  requiresConsentFor: OutboundChannel[];
  quietHours: { start: number; end: number };
}

const RULES: Record<string, RegionRule> = {
  AU: { defaultChannel: "SMS", requiresConsentFor: ["WHATSAPP"], quietHours: { start: 20, end: 8 } },
  NZ: { defaultChannel: "SMS", requiresConsentFor: ["WHATSAPP"], quietHours: { start: 20, end: 8 } },
  GB: { defaultChannel: "SMS", requiresConsentFor: ["WHATSAPP"], quietHours: { start: 20, end: 8 } },
  US: { defaultChannel: "SMS", requiresConsentFor: ["SMS", "WHATSAPP"], quietHours: { start: 21, end: 8 } },
  KH: { defaultChannel: "WHATSAPP", requiresConsentFor: [], quietHours: { start: 21, end: 7 } },
};

const FALLBACK: RegionRule = { defaultChannel: "SMS", requiresConsentFor: ["WHATSAPP"], quietHours: { start: 21, end: 8 } };

export function regionRule(region: string): RegionRule {
  return RULES[region.toUpperCase()] ?? FALLBACK;
}

/** Local hour (0–23) in the tenant's timezone right now. */
export function localHour(tenant: Pick<TenantSummary, "timezone">, now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: tenant.timezone, hour: "2-digit", hourCycle: "h23" }).formatToParts(now).find((p) => p.type === "hour")?.value ?? 0);
}

/** True when a non-urgent automated message should wait until morning. */
export function inQuietHours(tenant: Pick<TenantSummary, "timezone" | "region" | "sla">, now = new Date()): boolean {
  const q = tenant.sla.quietHours ?? regionRule(tenant.region).quietHours;
  const h = localHour(tenant, now);
  return q.start > q.end ? h >= q.start || h < q.end : h >= q.start && h < q.end;
}

/** Picks the channel for a contact: phone first in the region's default channel, else email. */
export function chooseChannel(tenant: Pick<TenantSummary, "region">, contact: { phone: string | null; email: string | null }): OutboundChannel | null {
  if (contact.phone) return regionRule(tenant.region).defaultChannel;
  if (contact.email) return "EMAIL";
  return null;
}

/** Country calling codes a tenant in each region may message by default. Tenants can widen this in settings later. */
const ALLOWED_CALLING_CODES: Record<string, string[]> = {
  AU: ["61"],
  NZ: ["64", "61"],
  GB: ["44"],
  US: ["1"],
  CA: ["1"],
  KH: ["855"],
  SG: ["65"],
  IE: ["353", "44"],
};

/**
 * Me² staff mobiles that any workspace may text, whatever its region, so an
 * operator abroad can be the test lead for a client. Read from
 * MESSAGING_STAFF_NUMBERS (E.164, comma-separated; spaces inside a number are
 * fine), kept as a deployment secret rather than in the repo; never a
 * per-workspace setting.
 */
export function staffNumbers(raw: string | undefined = process.env.MESSAGING_STAFF_NUMBERS): string[] {
  return (raw ?? "")
    .split(/[,;]+/)
    .map((n) => n.replace(/\D/g, ""))
    .filter((n) => n.length >= 8);
}

/**
 * Phone destinations are limited to the tenant's own country (and close
 * neighbours). A public form must never be able to point tenant-branded SMS
 * at premium or overseas numbers. The only exception is our own staff.
 */
export function destinationAllowed(tenant: Pick<TenantSummary, "region">, to: string, staff: string[] = staffNumbers()): boolean {
  const digits = to.replace(/\D/g, "");
  if (!to.startsWith("+") || digits.length < 8) return false;
  if (staff.includes(digits)) return true;
  const allowed = ALLOWED_CALLING_CODES[tenant.region.toUpperCase()] ?? [];
  return allowed.some((cc) => digits.startsWith(cc));
}

/**
 * A person's mobile as they typed it ("0490 415 758", "+61 490 415 758") as the
 * E.164 number this workspace may text, or null when it cannot be texted. Member
 * phones are stored however they were entered, so every text to a member goes
 * through here rather than straight to `destinationAllowed`.
 */
/**
 * The platform's own number, used instead of the workspace's when the
 * destination is a Me² staff mobile (`MESSAGING_STAFF_NUMBERS`): a workspace's
 * local number often cannot reach the country a staff member is testing from.
 * Set `MESSAGING_STAFF_FROM_NUMBER` (E.164) to a number that can.
 */
export function staffFromNumber(to: string, staff: string[] = staffNumbers(), from: string | undefined = process.env.MESSAGING_STAFF_FROM_NUMBER): string | null {
  const number = normalizePhone(from);
  if (!number?.startsWith("+")) return null;
  return staff.includes(to.replace(/\D/g, "")) ? number : null;
}

export function textableNumber(tenant: Pick<TenantSummary, "region">, raw: string | null | undefined, staff: string[] = staffNumbers()): string | null {
  const number = toE164(normalizePhone(raw), tenant.region);
  return number && destinationAllowed(tenant, number, staff) ? number : null;
}

/** The next instant quiet hours end in the tenant's timezone (today or tomorrow). */
export function quietHoursEnd(tenant: Pick<TenantSummary, "timezone" | "region" | "sla">, now = new Date()): Date {
  const q = tenant.sla.quietHours ?? regionRule(tenant.region).quietHours;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tenant.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now); // YYYY-MM-DD
  const todayEnd = zonedLocalToUtc(`${parts}T${String(q.end).padStart(2, "0")}:00`, tenant.timezone) ?? now;
  if (todayEnd.getTime() > now.getTime()) return todayEnd;
  const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: tenant.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now.getTime() + 86_400_000));
  return zonedLocalToUtc(`${tomorrow}T${String(q.end).padStart(2, "0")}:00`, tenant.timezone) ?? new Date(now.getTime() + 8 * 3_600_000);
}

/**
 * Moves a customer-facing send out of quiet hours: earlier the same evening when
 * there is still an hour before quiet hours begin, otherwise to the morning,
 * unless that would land after `notAfter` (then it stays where it was).
 */
export function clampOutOfQuietHours(tenant: Pick<TenantSummary, "timezone" | "region" | "sla">, runAt: Date, notAfter: Date | null, now = new Date()): Date {
  if (!inQuietHours(tenant, runAt)) return runAt;
  const q = tenant.sla.quietHours ?? regionRule(tenant.region).quietHours;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: tenant.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(runAt);
  const earlier = zonedLocalToUtc(`${day}T${String(Math.max(q.start - 1, 0)).padStart(2, "0")}:00`, tenant.timezone);
  if (earlier && earlier.getTime() > now.getTime() && earlier.getTime() < runAt.getTime()) return earlier;
  const morning = quietHoursEnd(tenant, runAt);
  if (!notAfter || morning.getTime() < notAfter.getTime() - 3_600_000) return morning;
  return runAt;
}
