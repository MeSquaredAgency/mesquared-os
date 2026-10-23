import type { TenantSummary } from "@/lib/types";
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
