import type { TenantSummary } from "@/lib/types";

/**
 * Automated message copy. Plain, warm, short; written for an older audience;
 * always says it is automated and comes from the business, never from Me².
 * Tenants can override wording later through MessageTemplate rows.
 */

/**
 * A first name safe to put in an outbound message: letters, spaces, hyphens
 * and apostrophes only, short, title-cased. Anything else (URLs, "verify your
 * account", 500-character strings) comes back as null and the message says
 * "Hi," instead. This is what stops a public form turning tenant SMS into
 * phishing.
 */
export function safeName(value: string | null | undefined): string | null {
  if (!value) return null;
  const words = value.trim().split(/\s+/);
  if (words.length > 3) return null; // a sentence, not a name
  const trimmed = words[0] ?? "";
  if (!/^[\p{L}][\p{L}'’-]{0,29}$/u.test(trimmed)) return null;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/** Only a topic the tenant itself lists as a service may be echoed back in a message. */
export function safeTopic(value: string | null | undefined, allowed: string[] | undefined): string | null {
  if (!value || !allowed?.length) return null;
  const v = value.trim().toLowerCase();
  return allowed.find((a) => a.toLowerCase() === v) ?? null;
}

export interface AcknowledgementInput {
  tenant: TenantSummary;
  firstName: string | null;
  bookingUrl: string;
  /** What they asked about, in a few words, e.g. "an appraisal". */
  topic: string | null;
  /** First name of the person the lead is assigned to, when the tenant signs messages as that person. */
  signedBy?: string | null;
}

/** "from Marissa at Harbor Realty Group" when signed by a person, "from Harbor Realty Group" otherwise. */
const fromWho = (tenant: TenantSummary, signedBy?: string | null) => (signedBy ? `${signedBy} at ${tenant.name}` : tenant.name);

export function acknowledgementSms({ tenant, firstName, bookingUrl, topic, signedBy }: AcknowledgementInput): string {
  const safe = safeName(firstName);
  const name = safe ? `Hi ${safe}, ` : "Hi, ";
  const about = topic ? ` about ${topic}` : "";
  const who = safeName(signedBy);
  return `${name}thanks for contacting ${tenant.name}${about}. Book a time here: ${bookingUrl} or reply and ${who ? `${who} will` : "a person will"} get back to you during business hours. This is an automated reply from ${fromWho(tenant, who)}.`;
}

export function acknowledgementEmail(input: AcknowledgementInput): { subject: string; body: string } {
  const { tenant, firstName, bookingUrl, topic } = input;
  const about = topic ? ` about ${topic}` : "";
  const who = safeName(input.signedBy);
  return {
    subject: `Thanks for contacting ${tenant.name}`,
    body: [
      safeName(firstName) ? `Hi ${safeName(firstName)},` : "Hi,",
      "",
      `Thank you for getting in touch with ${tenant.name}${about}. We've received your message and ${who ? `${who} will be in contact soon` : "someone will be in contact soon"}.`,
      "",
      `If you'd like to choose a time now, you can book here: ${bookingUrl}`,
      "",
      "If you'd rather talk first, just reply to this email.",
      "",
      `Kind regards,`,
      signoff(tenant, who),
      "",
      `This is an automated reply from ${fromWho(tenant, who)}.`,
    ].join("\n"),
  };
}

/** Text written by a stranger, shown to staff: URLs removed, length capped, so an alert can't carry a phishing link. */
export function quoteUntrusted(text: string, max = 400): string {
  return text.replace(/https?:\/\/\S+|www\.\S+/gi, "[link removed]").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Staff-facing sign-off: the client's own assistant, run by Me²; never "workspace" or "operator". */
const staffSignoff = (tenant: TenantSummary) => `— ${tenant.name} assistant, run by Me²`;

export function leadAlertEmail(input: { tenant: TenantSummary; leadName: string; summary: string; score: number; reason: string; phone: string | null; email: string | null; portalUrl: string; acknowledged: "SENT" | "HELD" | "SKIPPED" | "FAILED" | "NONE" }): { subject: string; body: string } {
  const { tenant, leadName, summary, reason, phone, email, portalUrl } = input;
  const ackLine = { SENT: "They've been sent a booking link automatically.", HELD: "Their booking link is queued for the morning (quiet hours).", SKIPPED: "No automatic reply went out (messaging isn't connected yet), so please reach them yourself.", FAILED: "The automatic reply couldn't be sent, so please call them.", NONE: "Automatic replies are off, so please reach them yourself." }[input.acknowledged];
  return {
    subject: `New lead for ${tenant.name}: ${quoteUntrusted(leadName, 60)}`,
    body: [
      `${quoteUntrusted(leadName, 60)} just got in touch with ${tenant.name}.`,
      "",
      "They wrote (quoted as received):",
      `"${quoteUntrusted(summary)}"`,
      "",
      `Why: ${reason}`,
      phone ? `Phone: ${phone}` : null,
      email ? `Email: ${email}` : null,
      "",
      `${ackLine} See the lead: ${portalUrl}`,
      "",
      staffSignoff(tenant),
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
  /** First name of the assigned person when the tenant signs messages as that person. */
  signedBy?: string | null;
}
const hi = (firstName: string | null) => {
  const safe = safeName(firstName);
  return safe ? `Hi ${safe},` : "Hi,";
};
const signoff = (tenant: TenantSummary, signedBy?: string | null) => (signedBy ? `${signedBy}, ${tenant.branding.fromName ?? tenant.name}` : (tenant.branding.fromName ?? tenant.name));
const auto = (tenant: TenantSummary, signedBy?: string | null) => `This is an automated message from ${fromWho(tenant, signedBy)}.`;

function pack(channel: Channel, subject: string, lines: string[], tenant: TenantSummary, signedBy?: string | null): { subject?: string; body: string } {
  const who = safeName(signedBy);
  if (channel === "EMAIL") return { subject, body: [...lines, "", "Kind regards,", signoff(tenant, who), "", auto(tenant, who)].join("\n") };
  return { body: `${lines.filter(Boolean).join(" ")} ${auto(tenant, who)}` };
}

/** "on Wednesday 4 November at 10:00 am" in the tenant's locale and timezone. */
export function whenPhrase(tenant: TenantSummary, at: Date | null): string | null {
  if (!at) return null;
  const date = at.toLocaleDateString(tenant.locale, { timeZone: tenant.timezone, weekday: "long", day: "numeric", month: "long" });
  const time = at.toLocaleTimeString(tenant.locale, { timeZone: tenant.timezone, hour: "numeric", minute: "2-digit" });
  return `on ${date} at ${time}`;
}

export function bookingConfirmation({ tenant, firstName, when, channel, rescheduled = false, signedBy }: Base & { when: string | null; rescheduled?: boolean }) {
  const verb = rescheduled ? "has been moved to" : "is confirmed for";
  return pack(channel, rescheduled ? `Your appointment with ${tenant.name} has moved` : `Your appointment with ${tenant.name} is confirmed`, [hi(firstName), when ? `your appointment with ${tenant.name} ${verb} ${when.replace(/^on /, "")}.` : `your appointment with ${tenant.name} is confirmed.`, "If you need to change it, just reply to this message."], tenant, signedBy);
}

export function bookingCancelled({ tenant, firstName, bookingUrl, channel, signedBy }: Base & { bookingUrl: string }) {
  return pack(channel, `Your appointment with ${tenant.name} has been cancelled`, [hi(firstName), `your appointment with ${tenant.name} has been cancelled. If you'd like another time, pick one here: ${bookingUrl}`, "Or reply and a person will get back to you during business hours."], tenant, signedBy);
}

export function bookingReminder({ tenant, firstName, when, channel, signedBy }: Base & { when: string | null }) {
  return pack(channel, `A reminder from ${tenant.name}`, [hi(firstName), when ? `a quick reminder about your appointment with ${tenant.name} ${when}.` : `a quick reminder about your upcoming appointment with ${tenant.name}.`, "Reply if you need to change the time."], tenant, signedBy);
}

/** After an attended appointment; `uncertain` when nobody confirmed they came, so the wording assumes nothing. */
export function bookingFollowUp({ tenant, firstName, channel, uncertain = false, signedBy }: Base & { uncertain?: boolean }) {
  if (uncertain) return pack(channel, `Following up from ${tenant.name}`, [hi(firstName), `thanks for booking time with ${tenant.name} this week. If anything is unclear or you'd like to talk it through, reply here and a person will come back to you.`], tenant, signedBy);
  return pack(channel, `Thanks for meeting with ${tenant.name}`, [hi(firstName), `thank you for your time with ${tenant.name}. If you have any questions about what we discussed, just reply and a person will get back to you.`], tenant, signedBy);
}

export function reviewRequest({ tenant, firstName, reviewUrl, channel }: Base & { reviewUrl: string }) {
  return pack(channel, `How did we do?`, [hi(firstName), `thanks for coming in to ${tenant.name}. If you have a minute, a short review helps other people find us: ${reviewUrl}`, "Reply STOP if you'd rather we didn't ask again."], tenant);
}

export function reactivation({ tenant, firstName, bookingUrl, channel }: Base & { bookingUrl: string }) {
  return pack(channel, `A quick hello from ${tenant.name}`, [hi(firstName), `it's been a while since we last spoke at ${tenant.name}. If there's anything we can help with, we'd be glad to. Pick a time here: ${bookingUrl}`, "Reply STOP if you'd rather not hear from us."], tenant);
}

export function missedCallSms({ tenant, firstName, bookingUrl }: { tenant: TenantSummary; firstName: string | null; bookingUrl: string }) {
  return `${hi(firstName)} sorry we missed your call to ${tenant.name}. Someone will call you back during business hours. If you'd rather pick a time now: ${bookingUrl} ${auto(tenant)}`;
}

export function chase({ tenant, firstName, what, channel, signedBy }: Base & { what: string }) {
  return pack(channel, `A quick reminder from ${tenant.name}`, [hi(firstName), `when you have a moment, we're still waiting on ${what}. Reply here if you have any questions or need a hand with it.`], tenant, signedBy);
}

/**
 * The reply to an enquiry handled without a person (e.g. a rental availability
 * question). The default is true on its own: it points at where the details
 * live and offers a human path, promising no follow-up.
 */
export function generalReply({ tenant, firstName, channel, custom, infoUrl, signedBy }: Base & { custom: string | null; infoUrl?: string | null }) {
  const body = custom ?? (infoUrl ? `thanks for your message to ${tenant.name}. The quickest way to get details and times is here: ${infoUrl}. If your question is about something else, reply here and a person will pick it up.` : `thanks for your message to ${tenant.name}. If you need anything else, reply here and a person will pick it up during business hours.`);
  return pack(channel, `Thanks for contacting ${tenant.name}`, [hi(firstName), body], tenant, signedBy);
}

export function invoiceReminder({ tenant, firstName, channel, number, amount, dueText, url, overdue }: Base & { number: string | null; amount: string; dueText: string; url: string | null; overdue: boolean }) {
  const ref = number ? `invoice ${number}` : "your invoice";
  const line = overdue ? `a quick note that ${ref} for ${amount} was due ${dueText} and is still open.` : `a reminder that ${ref} for ${amount} is due ${dueText}.`;
  return pack(channel, overdue ? `Overdue: ${ref} from ${tenant.name}` : `Reminder: ${ref} from ${tenant.name}`, [hi(firstName), line, url ? `You can view and pay it here: ${url}` : "", "If it's already been paid, thank you, and please ignore this. Reply if anything about it looks wrong."], tenant);
}

export function invoicePaidThanks({ tenant, firstName, channel, number }: Base & { number: string | null }) {
  return pack(channel, `Thanks from ${tenant.name}`, [hi(firstName), `thank you, your payment for ${number ? `invoice ${number}` : "your invoice"} has come through.`], tenant);
}

export function escalationEmail({ tenant, summary, suggestedAction, portalUrl }: { tenant: TenantSummary; summary: string; suggestedAction: string; portalUrl: string }) {
  return {
    subject: `${tenant.name}: needs a person — ${summary.slice(0, 60)}`,
    body: [`Something at ${tenant.name} needs a person:`, "", summary, "", `What we suggest: ${suggestedAction}`, "", `See it here: ${portalUrl}`, "", staffSignoff(tenant)].join("\n"),
  };
}
