import type { TenantSummary } from "@/lib/types";

export type OutboundChannel = "SMS" | "WHATSAPP" | "EMAIL";

/** The one thing the message asks the reader to do; the text version carries the URL, the HTML version a button. */
export interface MessageCta {
  label: string;
  url: string;
}

/** The person a message is signed by, for the email signature block. */
export interface MessageSignature {
  name: string;
  title: string | null;
  phone: string | null;
  email: string | null;
  photoUrl: string | null;
}

export interface OutboundMessage {
  channel: OutboundChannel;
  /** E.164 phone or email address. */
  to: string;
  body: string;
  /** Email only. */
  subject?: string;
  /** Display identity the message is sent under: the tenant's own, never Me²'s. */
  from: { name: string; address: string; replyTo?: string | null };
  cta?: MessageCta | null;
  signature?: MessageSignature | null;
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
  /** True when an earlier send with the same idempotency key answered instead; nothing new went out. */
  duplicate?: boolean;
}

export interface MessageProvider {
  readonly name: string;
  readonly channels: OutboundChannel[];
  send(message: OutboundMessage, tenant: TenantSummary): Promise<SendResult>;
}
