import { NextResponse, type NextRequest } from "next/server";
import { repository } from "@/lib/data";
import { parseEnquiryEmail, type InboundEmail } from "@/lib/intake/channels/email-parsers";
import { processIntake } from "@/lib/intake/process";
import { intakeSchema } from "@/lib/intake/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/inbound/email
 *
 * The forwarding inbox. An inbound-email provider (Resend, Postmark, Mailgun,
 * SendGrid) posts each message here; the recipient address identifies the
 * tenant through its EMAIL_FORWARDING integration. REA and Domain enquiry
 * emails are parsed into leads; anything else becomes a generic email lead.
 * Protected by INBOUND_EMAIL_SECRET as a bearer token or `?token=`.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? req.nextUrl.searchParams.get("token");
  if (secret && given !== secret) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!secret && process.env.NODE_ENV === "production") return NextResponse.json({ error: "INBOUND_EMAIL_SECRET is not configured." }, { status: 503 });

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const mail = normaliseInbound(payload);
  if (!mail) return NextResponse.json({ error: "Could not find from/to/text in the payload." }, { status: 422 });

  const tenant = await repository.findTenantByIntegrationAccount("EMAIL_FORWARDING", mail.to.toLowerCase());
  if (!tenant) return NextResponse.json({ received: true, ignored: "no workspace for this inbox address" });

  const enquiry = parseEnquiryEmail(mail);
  const parsed = intakeSchema.safeParse({
    source: enquiry.source,
    externalId: enquiry.externalId,
    name: enquiry.name,
    email: enquiry.email,
    phone: enquiry.phone,
    message: enquiry.message,
    fields: { ...enquiry.fields, utm_source: enquiry.provider.toLowerCase(), utm_medium: "portal_email" },
  });
  if (!parsed.success) {
    // Not enough to make a lead from (no contact details): log it for an operator rather than drop it.
    await repository.createException(tenant.id, { reason: `An email from ${mail.from} ("${mail.subject.slice(0, 80)}") had no usable contact details.`, suggestedAction: "Read the email in the forwarding inbox and reply by hand.", confidence: 0.3 });
    return NextResponse.json({ received: true, outcome: "exception" });
  }
  const result = await processIntake(tenant, parsed.data, { email: { from: mail.from, to: mail.to, subject: mail.subject, text: mail.text.slice(0, 5000) } }, { channel: enquiry.provider === "GENERIC" ? "EMAIL_FORWARD" : "PORTAL_EMAIL", provider: enquiry.provider });
  return NextResponse.json({ received: true, outcome: result.outcome, provider: enquiry.provider });
}

/** Accepts the common inbound-webhook shapes without binding to one provider. */
function normaliseInbound(p: Record<string, unknown>): InboundEmail | null {
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = k.split(".").reduce<unknown>((acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined), p);
      if (typeof v === "string" && v) return v;
      if (Array.isArray(v) && typeof v[0] === "string") return v[0];
    }
    return null;
  };
  const from = pick("from", "From", "sender", "envelope.from", "FromFull.Email");
  const to = pick("to", "To", "recipient", "envelope.to", "ToFull.0.Email");
  const text = pick("text", "TextBody", "body-plain", "stripped-text", "plain", "html", "HtmlBody");
  const subject = pick("subject", "Subject") ?? "";
  const messageId = pick("message_id", "MessageID", "Message-Id", "headers.message-id", "id");
  if (!from || !to || !text) return null;
  return { from, to, subject, text: text.replace(/<[^>]+>/g, " "), messageId };
}
