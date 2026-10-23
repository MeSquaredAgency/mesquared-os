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
