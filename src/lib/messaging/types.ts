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
  from: { name: string; address: string };
}

export interface SendResult {
  ok: boolean;
  providerMessageId: string | null;
  /** Why it was not sent: provider error, no credentials, quiet hours, no consent. */
  error: string | null;
  /** True when nothing was sent because the provider is not configured (demo/dev). */
  simulated: boolean;
}

export interface MessageProvider {
  readonly name: string;
  readonly channels: OutboundChannel[];
  send(message: OutboundMessage, tenant: TenantSummary): Promise<SendResult>;
}
