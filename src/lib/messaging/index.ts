import { repository } from "@/lib/data";
import type { TenantSummary } from "@/lib/types";
import { chooseChannel, inQuietHours } from "./policy";
import { providerFor } from "./providers";
import type { OutboundChannel, OutboundMessage, SendResult } from "./types";

export * from "./types";
export { chooseChannel, inQuietHours, regionRule } from "./policy";
export * as templates from "./templates";

export interface SendOptions {
  tenant: TenantSummary;
  contactId: string | null;
  channel: OutboundChannel;
  to: string;
  body: string;
  subject?: string;
  automationRunId?: string | null;
  /** Transactional messages (acknowledging an enquiry) ignore quiet hours. */
  transactional?: boolean;
}

/** The sender identity for a channel: the tenant's number or address, with its name. */
async function senderFor(tenant: TenantSummary, channel: OutboundChannel): Promise<OutboundMessage["from"] | null> {
  const name = tenant.branding.fromName ?? tenant.name;
  if (channel === "EMAIL") {
    const address = tenant.branding.replyTo ?? (process.env.DEFAULT_FROM_EMAIL ? process.env.DEFAULT_FROM_EMAIL : null);
    return address ? { name, address } : null;
  }
  const twilio = await repository.findIntegration(tenant.id, "TWILIO");
  const fromNumber = typeof twilio?.settings.fromNumber === "string" ? twilio.settings.fromNumber : process.env.DEFAULT_FROM_NUMBER;
  return fromNumber ? { name, address: fromNumber } : null;
}

/**
 * Sends one automated message under the tenant's identity and records it on
 * the contact's conversation whatever happens, so "Handled for you" and the
 * inbox always tell the truth about what went out.
 */
export async function sendMessage(opts: SendOptions): Promise<SendResult & { messageId: string | null }> {
  const { tenant } = opts;
  const record = async (status: "SENT" | "FAILED" | "QUEUED", providerMessageId: string | null) =>
    repository.recordMessage(tenant.id, {
      contactId: opts.contactId,
      channel: opts.channel,
      direction: "OUTBOUND",
      sender: "AUTOMATION",
      body: opts.body,
      subject: opts.subject ?? null,
      status,
      providerMessageId,
      automationRunId: opts.automationRunId ?? null,
    });

  if (!opts.transactional && inQuietHours(tenant)) {
    const { messageId } = await record("QUEUED", null);
    return { ok: false, providerMessageId: null, error: "Held until morning (quiet hours).", simulated: false, messageId };
  }

  const from = await senderFor(tenant, opts.channel);
  if (!from) {
    const { messageId } = await record("FAILED", null);
    return { ok: false, providerMessageId: null, error: `No sender identity configured for ${opts.channel} on this workspace.`, simulated: true, messageId };
  }

  const result = await providerFor(opts.channel).send({ channel: opts.channel, to: opts.to, body: opts.body, subject: opts.subject, from }, tenant);
  const { messageId } = await record(result.ok ? "SENT" : "FAILED", result.providerMessageId);
  return { ...result, messageId };
}

export { chooseChannel as channelFor };
