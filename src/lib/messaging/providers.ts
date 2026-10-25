import { renderEmailHtml } from "./email-layout";
import type { MessageProvider, OutboundMessage, SendResult } from "./types";

/**
 * Providers are platform-level accounts (Twilio, Resend). Each tenant still
 * sends under its own identity: the sender name, number and reply-to come
 * from the tenant's integration settings and branding, never from Me².
 */

/** Twilio for SMS and WhatsApp, via its REST API (no SDK needed for a single endpoint). */
export const twilioProvider: MessageProvider = {
  name: "twilio",
  channels: ["SMS", "WHATSAPP"],
  async send(message, tenant): Promise<SendResult> {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) return { ok: false, providerMessageId: null, error: "Twilio is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).", simulated: true };
    const prefix = message.channel === "WHATSAPP" ? "whatsapp:" : "";
    const body = new URLSearchParams({ To: `${prefix}${message.to}`, From: `${prefix}${message.from.address}`, Body: message.body });
    try {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
      if (!res.ok) return { ok: false, providerMessageId: null, error: json.message ?? `Twilio HTTP ${res.status}`, simulated: false };
      return { ok: true, providerMessageId: json.sid ?? null, error: null, simulated: false };
    } catch (error) {
      return { ok: false, providerMessageId: null, error: error instanceof Error ? error.message : "Twilio request failed", simulated: false };
    } finally {
      void tenant;
    }
  },
};

/** Resend for email. */
export const resendProvider: MessageProvider = {
  name: "resend",
  channels: ["EMAIL"],
  async send(message, tenant): Promise<SendResult> {
    const key = process.env.RESEND_API_KEY;
    if (!key) return { ok: false, providerMessageId: null, error: "Resend is not configured (RESEND_API_KEY).", simulated: true };
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: `${message.from.name} <${message.from.address}>`, to: [message.to], subject: message.subject ?? "", text: message.body, html: renderEmailHtml(tenant, message.body, { cta: message.cta ?? null, signature: message.signature ?? null }), ...(message.from.replyTo ? { reply_to: message.from.replyTo } : {}) }),
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok) return { ok: false, providerMessageId: null, error: json.message ?? `Resend HTTP ${res.status}`, simulated: false };
      return { ok: true, providerMessageId: json.id ?? null, error: null, simulated: false };
    } catch (error) {
      return { ok: false, providerMessageId: null, error: error instanceof Error ? error.message : "Resend request failed", simulated: false };
    }
  },
};

/** Logs instead of sending. Used in tests and whenever MESSAGING_MODE=log. */
export const logProvider: MessageProvider = {
  name: "log",
  channels: ["SMS", "WHATSAPP", "EMAIL"],
  async send(message, tenant): Promise<SendResult> {
    const redact = process.env.NODE_ENV === "production";
    console.info(`[messaging:log] ${tenant.slug} ${message.channel} → ${redact ? message.to.slice(0, 4) + "…" : message.to} from ${message.from.name}: ${redact ? "[body redacted]" : message.body.slice(0, 240)}`);
    return { ok: true, providerMessageId: `log_${Date.now()}`, error: null, simulated: true };
  },
};

export function providerFor(channel: OutboundMessage["channel"]): MessageProvider {
  if (process.env.MESSAGING_MODE === "log") return logProvider;
  return channel === "EMAIL" ? resendProvider : twilioProvider;
}
