import { NextResponse, type NextRequest } from "next/server";
import { repository } from "@/lib/data";
import { emit } from "@/lib/events";
import { verifyTwilioSignature } from "@/lib/intake/channels/twilio";
import { normalizePhone } from "@/lib/intake/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STOP_WORDS = /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\b/i;
const START_WORDS = /^\s*(start|unstop|yes)\b/i;


/**
 * POST /api/v1/inbound/sms — replies to the tenant's number. STOP/UNSUBSCRIBE
 * withdraws SMS consent for that contact; everything else is recorded on the
 * conversation and marked as awaiting a reply, so a person sees it.
 */
export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected form data." }, { status: 400 });
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") params[k] = v;

  if (authToken) {
    const url = process.env.TWILIO_WEBHOOK_URL ?? req.url;
    if (!verifyTwilioSignature(url, params, req.headers.get("x-twilio-signature"), authToken)) return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "TWILIO_AUTH_TOKEN is not configured." }, { status: 503 });
  }

  const to = normalizePhone(params.To ?? "");
  const from = normalizePhone(params.From ?? "");
  const body = (params.Body ?? "").trim();
  if (!to || !from) return NextResponse.json({ error: "Missing To/From." }, { status: 422 });

  const tenant = await repository.findTenantByIntegrationAccount("TWILIO", to);
  if (!tenant) return new NextResponse("<Response></Response>", { headers: { "Content-Type": "text/xml" } });

  const contact = await repository.upsertContact(tenant.id, { firstName: null, lastName: null, email: null, phone: from, company: null });
  await repository.recordMessage(tenant.id, { contactId: contact.id, channel: "SMS", direction: "INBOUND", sender: "CONTACT", body: body || "(empty)", status: "RECEIVED", providerMessageId: params.MessageSid ?? null });

  if (STOP_WORDS.test(body)) {
    await repository.setContactConsent(tenant.id, contact.id, "sms", false, "STOP reply");
    await repository.recordAutomationRun(tenant.id, { typeKey: "enquiry_auto_reply", outcome: "COMPLETED", summary: "A contact replied STOP; no more text messages will be sent to them.", contactId: contact.id });
    await emit(tenant.id, "consent.withdrawn", { contactId: contact.id, channel: "sms" });
  } else if (START_WORDS.test(body)) {
    await repository.setContactConsent(tenant.id, contact.id, "sms", true, "START reply");
    await emit(tenant.id, "consent.granted", { contactId: contact.id, channel: "sms" });
  } else {
    await emit(tenant.id, "message.received", { contactId: contact.id, channel: "SMS" });
  }
  // Twilio expects TwiML; an empty response sends nothing back (carriers handle STOP confirmations).
  return new NextResponse("<Response></Response>", { headers: { "Content-Type": "text/xml" } });
}
