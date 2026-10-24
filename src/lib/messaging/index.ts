import { createHash } from "node:crypto";
import { repository } from "@/lib/data";
import type { TenantSummary } from "@/lib/types";
import { chooseChannel, destinationAllowed, inQuietHours, quietHoursEnd, regionRule } from "./policy";
import { providerFor } from "./providers";
import type { OutboundChannel, OutboundMessage, SendResult } from "./types";

export * from "./types";
export { chooseChannel, clampOutOfQuietHours, inQuietHours, quietHoursEnd, regionRule } from "./policy";
export * as templates from "./templates";
export { safeName } from "./templates";

export interface SendOptions {
  tenant: TenantSummary;
  contactId: string | null;
  channel: OutboundChannel;
  to: string;
  body: string;
  subject?: string;
  automationRunId?: string | null;
  /**
   * Transactional messages (acknowledging an enquiry, confirming a booking,
   * replying to a missed call) ignore quiet hours and need no marketing
   * consent. Everything else (review requests, reactivation) is marketing.
   */
  transactional?: boolean;
}

/** Caps on automated sends, per tenant per day and per recipient per day. Overridable for big tenants. */
const DAILY_TENANT_CAP = Number.parseInt(process.env.MESSAGING_DAILY_CAP ?? "500", 10) || 500;
const DAILY_RECIPIENT_CAP = Number.parseInt(process.env.MESSAGING_RECIPIENT_DAILY_CAP ?? "4", 10) || 4;

/** The sender identity for a channel: the tenant's number or address, with its name. */
async function senderFor(tenant: TenantSummary, channel: OutboundChannel): Promise<OutboundMessage["from"] | null> {
  const name = tenant.branding.fromName ?? tenant.name;
  if (channel === "EMAIL") {
    // Email goes out from the platform's verified sending domain under the tenant's name;
    // replies go straight to the tenant's own address.
    const platform = process.env.DEFAULT_FROM_EMAIL || null;
    const replyTo = tenant.branding.replyTo ?? null;
    const address = platform ?? replyTo;
    return address ? { name, address, replyTo } : null;
  }
  const twilio = await repository.findIntegration(tenant.id, "TWILIO");
  const fromNumber = typeof twilio?.settings.fromNumber === "string" ? twilio.settings.fromNumber : process.env.DEFAULT_FROM_NUMBER;
  return fromNumber ? { name, address: fromNumber } : null;
}

/**
 * Sends one automated message under the tenant's identity and records it on
 * the contact's conversation whatever happens, so "Handled for you" and the
 * inbox always tell the truth about what went out.
 *
 * Policy enforced here, not in callers: destination country allow-list,
 * marketing consent by region, quiet hours for marketing, and daily caps per
 * tenant and per recipient (which also blunt SMS-pumping through public forms).
 */
export async function sendMessage(opts: SendOptions): Promise<SendResult & { messageId: string | null }> {
  const { tenant } = opts;
  const record = async (status: "SENT" | "FAILED" | "QUEUED", providerMessageId: string | null) =>
    repository.recordMessage(tenant.id, {
      contactId: opts.contactId,
      to: opts.to,
      channel: opts.channel,
      direction: "OUTBOUND",
      sender: "AUTOMATION",
      body: opts.body,
      subject: opts.subject ?? null,
      status,
      providerMessageId,
      automationRunId: opts.automationRunId ?? null,
    });
  const refuse = async (error: string, simulated = false) => {
    const { messageId } = await record("FAILED", null);
    return { ok: false, providerMessageId: null, error, simulated, messageId };
  };

  if (opts.channel !== "EMAIL" && !destinationAllowed(tenant, opts.to)) {
    return refuse(`Destination ${opts.to.slice(0, 4)}… is outside the countries this workspace may message.`);
  }

  if (!opts.transactional) {
    const needs = regionRule(tenant.region).requiresConsentFor;
    if (needs.includes(opts.channel)) {
      const contact = opts.contactId ? await repository.findContactById(tenant.id, opts.contactId) : null;
      const key = opts.channel.toLowerCase() as "sms" | "whatsapp" | "email";
      if (!contact?.consent[key]?.granted) return refuse(`No ${opts.channel.toLowerCase()} marketing consent recorded for this contact.`);
    }
    if (inQuietHours(tenant)) {
      // Not dropped: queued as a scheduled action that re-runs this send when quiet hours end.
      const releaseAt = quietHoursEnd(tenant);
      await repository.scheduleAction(tenant.id, {
        typeKey: "messaging",
        action: "release",
        runAt: releaseAt,
        payload: { contactId: opts.contactId, channel: opts.channel, to: opts.to, body: opts.body, subject: opts.subject ?? null, automationRunId: opts.automationRunId ?? null },
        dedupeKey: `release:${opts.to}:${createHash("sha1").update(opts.body).digest("hex").slice(0, 12)}`,
      });
      const when = releaseAt.toLocaleString(tenant.locale, { timeZone: tenant.timezone, hour: "numeric", minute: "2-digit" });
      return { ok: false, providerMessageId: null, error: `Held until ${when} (quiet hours).`, simulated: false, held: true, messageId: null };
    }
  }

  const since = new Date(Date.now() - 24 * 3_600_000);
  const [tenantCount, recipientCount] = await Promise.all([repository.countOutboundMessages(tenant.id, { since }), repository.countOutboundMessages(tenant.id, { since, to: opts.to })]);
  if (tenantCount >= DAILY_TENANT_CAP) return refuse(`This workspace has reached its daily limit of ${DAILY_TENANT_CAP} automated messages.`);
  if (recipientCount >= DAILY_RECIPIENT_CAP) return refuse(`Already sent ${recipientCount} automated messages to this recipient today; holding back.`);

  const from = await senderFor(tenant, opts.channel);
  if (!from) return refuse(`No sender identity configured for ${opts.channel} on this workspace.`, true);

  const result = await providerFor(opts.channel).send({ channel: opts.channel, to: opts.to, body: opts.body, subject: opts.subject, from }, tenant);
  const { messageId } = await record(result.ok ? "SENT" : "FAILED", result.providerMessageId);
  return { ...result, messageId };
}

export { chooseChannel as channelFor };
