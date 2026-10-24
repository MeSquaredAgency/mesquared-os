import type { TenantSummary } from "@/lib/types";

/**
 * Automated message copy. Plain, warm, short; written for an older audience;
 * always says it is automated and comes from the business, never from Me².
 * Tenants can override wording later through MessageTemplate rows.
 */

export interface AcknowledgementInput {
  tenant: TenantSummary;
  firstName: string | null;
  bookingUrl: string;
  /** What they asked about, in a few words, e.g. "an appraisal". */
  topic: string | null;
}

export function acknowledgementSms({ tenant, firstName, bookingUrl, topic }: AcknowledgementInput): string {
  const name = firstName ? `Hi ${firstName}, ` : "Hi, ";
  const about = topic ? ` about ${topic}` : "";
  return `${name}thanks for getting in touch with ${tenant.name}${about}. Pick a time that suits you here: ${bookingUrl} — or just reply to this message and a person will call you. (Automated reply from ${tenant.name}.)`;
}

export function acknowledgementEmail(input: AcknowledgementInput): { subject: string; body: string } {
  const { tenant, firstName, bookingUrl, topic } = input;
  const about = topic ? ` about ${topic}` : "";
  return {
    subject: `Thanks for contacting ${tenant.name}`,
    body: [
      firstName ? `Hi ${firstName},` : "Hi,",
      "",
      `Thank you for getting in touch with ${tenant.name}${about}. We've received your message and someone will be in contact soon.`,
      "",
      `If you'd like to choose a time now, you can book here: ${bookingUrl}`,
      "",
      "If you'd rather talk first, just reply to this email.",
      "",
      `Kind regards,`,
      tenant.branding.fromName ?? tenant.name,
      "",
      `This is an automated reply from ${tenant.name}.`,
    ].join("\n"),
  };
}

export function leadAlertEmail(input: { tenant: TenantSummary; leadName: string; summary: string; score: number; reason: string; phone: string | null; email: string | null; portalUrl: string }): { subject: string; body: string } {
  const { tenant, leadName, summary, score, reason, phone, email, portalUrl } = input;
  return {
    subject: `New lead for ${tenant.name}: ${leadName}`,
    body: [
      `${leadName} just got in touch with ${tenant.name}.`,
      "",
      `"${summary}"`,
      "",
      `Why it matters: ${reason} (intent ${score}/100)`,
      phone ? `Phone: ${phone}` : null,
      email ? `Email: ${email}` : null,
      "",
      `They've been sent a booking link. See the lead: ${portalUrl}`,
      "",
      "— MeSquared OS, on behalf of your workspace",
    ]
      .filter((l) => l !== null)
      .join("\n"),
  };
}

type Channel = "SMS" | "WHATSAPP" | "EMAIL";
interface Base {
  tenant: TenantSummary;
  firstName: string | null;
  channel: Channel;
}
const hi = (firstName: string | null) => (firstName ? `Hi ${firstName},` : "Hi,");
const signoff = (tenant: TenantSummary) => tenant.branding.fromName ?? tenant.name;
const auto = (tenant: TenantSummary) => `(Automated message from ${tenant.name}.)`;

function pack(channel: Channel, subject: string, lines: string[], tenant: TenantSummary): { subject?: string; body: string } {
  if (channel === "EMAIL") return { subject, body: [...lines, "", "Kind regards,", signoff(tenant), "", `This is an automated message from ${tenant.name}.`].join("\n") };
  return { body: `${lines.filter(Boolean).join(" ")} ${auto(tenant)}` };
}

export function bookingConfirmation({ tenant, firstName, when, channel }: Base & { when: string | null }) {
  return pack(channel, `Your appointment with ${tenant.name} is confirmed`, [hi(firstName), when ? `your appointment with ${tenant.name} is confirmed for ${when}.` : `your appointment with ${tenant.name} is confirmed.`, "If you need to change it, just reply to this message."], tenant);
}

export function bookingReminder({ tenant, firstName, when, channel }: Base & { when: string | null }) {
  return pack(channel, `A reminder from ${tenant.name}`, [hi(firstName), when ? `a quick reminder about your appointment ${when} with ${tenant.name}.` : `a quick reminder about your upcoming appointment with ${tenant.name}.`, "Reply if you need to change the time."], tenant);
}

export function bookingFollowUp({ tenant, firstName, channel }: Base) {
  return pack(channel, `Thanks for meeting with ${tenant.name}`, [hi(firstName), `thank you for your time with ${tenant.name}. If you have any questions about what we discussed, just reply and a person will get back to you.`], tenant);
}

export function reviewRequest({ tenant, firstName, reviewUrl, channel }: Base & { reviewUrl: string }) {
  return pack(channel, `How did we do?`, [hi(firstName), `thanks again for choosing ${tenant.name}. If you have a moment, a short review helps other people find us: ${reviewUrl}`], tenant);
}

export function reactivation({ tenant, firstName, bookingUrl, channel }: Base & { bookingUrl: string }) {
  return pack(channel, `We'd love to see you again`, [hi(firstName), `it's been a while since we've seen you at ${tenant.name}, and we'd love to help again whenever you're ready. You can pick a time here: ${bookingUrl}`, "Reply STOP if you'd rather not hear from us."], tenant);
}

export function missedCallSms({ tenant, firstName, bookingUrl }: { tenant: TenantSummary; firstName: string | null; bookingUrl: string }) {
  return `${hi(firstName)} sorry we missed your call to ${tenant.name}. We'll call you back shortly, or you can pick a time that suits you here: ${bookingUrl} ${auto(tenant)}`;
}

export function chase({ tenant, firstName, what, channel }: Base & { what: string }) {
  return pack(channel, `A quick reminder from ${tenant.name}`, [hi(firstName), `when you have a moment, we're still waiting on ${what}. Reply here if you have any questions or need a hand with it.`], tenant);
}

export function generalReply({ tenant, firstName, channel, custom }: Base & { custom: string | null }) {
  return pack(channel, `Thanks for contacting ${tenant.name}`, [hi(firstName), custom ?? `thanks for getting in touch with ${tenant.name}. We've received your message and will get back to you with the details shortly.`], tenant);
}

export function escalationEmail({ tenant, summary, suggestedAction, portalUrl }: { tenant: TenantSummary; summary: string; suggestedAction: string; portalUrl: string }) {
  return {
    subject: `Needs you: ${summary.slice(0, 70)}`,
    body: [`Something at ${tenant.name} needs a person:`, "", summary, "", `Suggested: ${suggestedAction}`, "", `See it here: ${portalUrl}`, "", "— MeSquared OS, on behalf of your workspace"].join("\n"),
  };
}
