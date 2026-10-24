import type { TenantSummary } from "@/lib/types";

export type OutboundChannel = "SMS" | "WHATSAPP" | "EMAIL";

export interface OutboundMessage {
  channel: OutboundChannel;
  /** E.164 phone or email address. */
  to: string;
  body: string;
  /** Email only. */
  subject?: string;
  /** Display identity the message is sent under: the tenant's own, never Me²'s. */
  from: { name: string; address: string; replyTo?: string | null };
}

export interface SendResult {
  ok: boolean;
  providerMessageId: string | null;
  /** Why it was not sent: provider error, no credentials, quiet hours, no consent. */
  error: string | null;
  /** True when nothing was sent because the provider is not configured (demo/dev). */
  simulated: boolean;
  /** True when the message was not sent now but is queued for the end of quiet hours. */
  held?: boolean;
}

export interface MessageProvider {
  readonly name: string;
  readonly channels: OutboundChannel[];
  send(message: OutboundMessage, tenant: TenantSummary): Promise<SendResult>;
}
