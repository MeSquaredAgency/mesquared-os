import type { IntakeBody } from "@/lib/intake/schema";

/**
 * Parsers for enquiry emails that land in a tenant's forwarding inbox.
 * Each returns the fields it could find; the caller validates with the
 * intake schema. Portal formats drift, so matching is tolerant: labelled
 * lines first, then regexes over the whole text.
 */

export interface InboundEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
  messageId?: string | null;
}

export interface ParsedEnquiry {
  provider: "REA" | "DOMAIN" | "GENERIC";
  source: IntakeBody["source"];
  externalId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  fields: Record<string, string>;
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /(\+?\d[\d\s().-]{7,}\d)/;

function labelled(text: string, labels: string[]): string | null {
  for (const label of labels) {
    const re = new RegExp(`^\\s*${label}\\s*[:\\-]\\s*(.+)$`, "im");
    const m = re.exec(text);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function addressOf(from: string): string | null {
  const m = EMAIL_RE.exec(from);
  return m ? m[0].toLowerCase() : null;
}

/** "Ken Owner <ken@example.com>" → "Ken Owner"; a bare address → null. */
function displayNameOf(from: string): string | null {
  const m = /^\s*"?([^"<]+?)"?\s*<[^>]+>/.exec(from);
  const name = m?.[1]?.trim();
  return name && !EMAIL_RE.test(name) ? name : null;
}

/** First thing that looks like a phone number anywhere in the text, excluding years and prices. */
function phoneAnywhere(text: string): string | null {
  const re = /(?:^|[^\d$])((?:\+?\d[\d().-]*\s?){8,16})(?=\D|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const digits = m[1].replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 15 && !/^(19|20)\d{2}$/.test(digits)) return m[1].trim();
  }
  return null;
}

export function detectProvider(mail: InboundEmail): ParsedEnquiry["provider"] {
  const hay = `${mail.from} ${mail.subject}`.toLowerCase();
  if (/realestate\.com\.au|\brea\b/.test(hay)) return "REA";
  if (/domain\.com\.au|\bdomain\b/.test(hay)) return "DOMAIN";
  return "GENERIC";
}

export function parseEnquiryEmail(mail: InboundEmail): ParsedEnquiry {
  const provider = detectProvider(mail);
  const text = mail.text.replace(/\r/g, "");
  const name = labelled(text, ["Name", "From", "Enquirer", "Contact name"]) ?? (provider === "GENERIC" ? displayNameOf(mail.from) : null);
  const email = labelled(text, ["Email", "Email address"])?.match(EMAIL_RE)?.[0]?.toLowerCase() ?? (provider === "GENERIC" ? addressOf(mail.from) : null);
  const phone = labelled(text, ["Phone", "Mobile", "Phone number", "Contact number"])?.match(PHONE_RE)?.[0] ?? phoneAnywhere(text);
  const property = labelled(text, ["Property", "Listing", "Address", "Property address"]) ?? /(?:enquiry (?:about|for|on)|re:)\s*(.+)/i.exec(mail.subject)?.[1]?.trim() ?? null;
  const enquiryType = labelled(text, ["Enquiry type", "Type", "Reason"]);

  // Message: the labelled block, else the body after the last label line, else the subject.
  let message = labelled(text, ["Message", "Comments", "Enquiry", "Their message"]);
  if (!message) {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const lastLabelIdx = lines.reduce((idx, l, i) => (/^[A-Za-z ]{2,20}:/.test(l) ? i : idx), -1);
    const tail = lines.slice(lastLabelIdx + 1).join(" ").trim();
    message = tail || mail.subject || null;
  }
  if (property && message && !message.toLowerCase().includes(property.toLowerCase())) message = `${message} (re: ${property})`;

  const fields: Record<string, string> = {};
  if (property) fields.property = property;
  if (enquiryType) fields.enquiryType = enquiryType;
  fields.forwardedFrom = addressOf(mail.from) ?? mail.from;
  if (mail.subject) fields.subject = mail.subject.slice(0, 200);

  return {
    provider,
    source: provider === "GENERIC" ? "EMAIL" : "PORTAL_EMAIL",
    externalId: mail.messageId ? `email:${mail.messageId}` : null,
    name,
    email,
    phone,
    message,
    fields,
  };
}
