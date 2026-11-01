import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { onMissedCall, registerAutomations } from "@/lib/automations/handlers";
import { clientIpFromHeaders } from "@/lib/auth/client-ip";
import { localKey } from "@/lib/content/calendar";
import { repository } from "@/lib/data";
import { emit } from "@/lib/events";
import { takeIntakeTokens } from "@/lib/intake/rate-limit";
import { normalizePhone, toE164 } from "@/lib/intake/schema";
import { leadDisplayName } from "@/lib/leads";
import { quoteUntrusted, safeName } from "@/lib/messaging/templates";
import { raiseMissedOpportunity } from "@/lib/opportunities/raise";
import { resolveTenantFromRequest } from "@/lib/tenant/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const callSchema = z.object({
  from: z.string().min(6).max(40),
  status: z.enum(["missed", "voicemail", "answered"]),
  callerName: z.string().max(120).optional().nullable(),
  transcription: z.string().max(2000).optional().nullable(),
  externalId: z.string().max(120).optional().nullable(),
  occurredAt: z.string().optional(),
});

/**
 * POST /api/v1/inbound/call
 *
 * Call-tracking providers post call outcomes here, authenticated with the
 * tenant's API key (configure it as a header in the provider). A missed call
 * or voicemail becomes a PHONE conversation entry, a missed opportunity for an
 * operator, and (when the tenant has it on) one text back per caller per day
 * with a booking link. The business number is never accepted as a credential.
 */
export async function POST(req: NextRequest) {
  registerAutomations();
  const auth = await resolveTenantFromRequest(req, "webhooks");
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const tenant = auth.tenant;

  const parsed = callSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid call payload.", issues: z.flattenError(parsed.error).fieldErrors }, { status: 422 });

  const phone = toE164(normalizePhone(parsed.data.from), tenant.region);
  if (!phone) return NextResponse.json({ error: "Caller number is not usable." }, { status: 422 });

  const ip = clientIpFromHeaders((n) => req.headers.get(n));
  const limit = await takeIntakeTokens([`call:${tenant.id}`, `call:${tenant.id}:${phone}`, `ip:${ip}`]);
  if (!limit.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });

  const name = safeName(parsed.data.callerName);
  const contact = await repository.upsertContact(tenant.id, { firstName: name, lastName: null, email: null, phone, company: null });

  const label = parsed.data.status === "voicemail" ? "Voicemail" : parsed.data.status === "missed" ? "Missed call" : "Call";
  const transcript = parsed.data.transcription ? quoteUntrusted(parsed.data.transcription, 500) : null;
  await repository.recordMessage(tenant.id, { contactId: contact.id, channel: "PHONE", direction: "INBOUND", sender: "CONTACT", body: transcript ? `${label}: ${transcript}` : label, status: "RECEIVED", providerMessageId: parsed.data.externalId ?? null });
  await emit(tenant.id, "call.received", { contactId: contact.id, status: parsed.data.status });

  if (parsed.data.status === "answered") return NextResponse.json({ received: true, outcome: "logged" });

  // One open item per caller per day on the tenant's calendar, whatever the provider sends as an id.
  const day = localKey(tenant.timezone, new Date());
  const raised = await raiseMissedOpportunity(tenant, {
    type: "MISSED_CALL",
    leadId: null,
    contactId: contact.id,
    subjectId: `${contact.id}:${day}`,
    summary: `${leadDisplayName(contact)} called and nobody answered${transcript ? ` (voicemail: "${transcript.slice(0, 120)}")` : ""}.`,
    suggestedAction: "Call back within the hour. A text with a booking link has gone out if the workspace has that on.",
    confidence: 0.8,
  });
  await onMissedCall(tenant, contact);
  return NextResponse.json({ received: true, outcome: raised ? "raised" : "already_open" });
}
