import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { onMissedCall, registerAutomations } from "@/lib/automations/handlers";
import { repository } from "@/lib/data";
import { emit } from "@/lib/events";
import { normalizePhone, toE164 } from "@/lib/intake/schema";
import { leadDisplayName } from "@/lib/leads";
import { raiseMissedOpportunity } from "@/lib/opportunities/raise";
import { resolveTenantFromRequest } from "@/lib/tenant/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const callSchema = z.object({
  from: z.string().min(6),
  /** The business number that was called; resolves the tenant when no API key is sent. */
  to: z.string().optional(),
  status: z.enum(["missed", "voicemail", "answered"]),
  callerName: z.string().optional().nullable(),
  transcription: z.string().max(5000).optional().nullable(),
  externalId: z.string().optional().nullable(),
  occurredAt: z.string().optional(),
});

/**
 * POST /api/v1/inbound/call
 *
 * Call-tracking providers post call outcomes here. A missed call or voicemail
 * becomes a PHONE conversation entry, a missed opportunity raised for an
 * operator, and (when the tenant has it on) an immediate text back with a
 * booking link. Authenticate with the tenant API key, or send `to` (the
 * tracked number stored on the tenant's CALL_TRACKING or TWILIO integration).
 */
export async function POST(req: NextRequest) {
  registerAutomations();
  const body = await req.json().catch(() => null);
  const parsed = callSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid call payload.", issues: z.flattenError(parsed.error).fieldErrors }, { status: 422 });

  const auth = await resolveTenantFromRequest(req);
  const tenant = auth.ok
    ? auth.tenant
    : parsed.data.to
      ? ((await repository.findTenantByIntegrationAccount("CALL_TRACKING", normalizePhone(parsed.data.to) ?? parsed.data.to)) ?? (await repository.findTenantByIntegrationAccount("TWILIO", normalizePhone(parsed.data.to) ?? parsed.data.to)))
      : null;
  if (!tenant) return NextResponse.json({ error: auth.ok ? "Unknown tenant." : auth.error }, { status: auth.ok ? 404 : auth.status });

  const phone = toE164(normalizePhone(parsed.data.from), tenant.region);
  if (!phone) return NextResponse.json({ error: "Caller number is not usable." }, { status: 422 });
  const [firstName, ...rest] = (parsed.data.callerName ?? "").trim().split(/\s+/).filter(Boolean);
  const contact = await repository.upsertContact(tenant.id, { firstName: firstName ?? null, lastName: rest.join(" ") || null, email: null, phone, company: null });

  const label = parsed.data.status === "voicemail" ? "Voicemail" : parsed.data.status === "missed" ? "Missed call" : "Call";
  await repository.recordMessage(tenant.id, { contactId: contact.id, channel: "PHONE", direction: "INBOUND", sender: "CONTACT", body: parsed.data.transcription ? `${label}: ${parsed.data.transcription}` : label, status: "RECEIVED", providerMessageId: parsed.data.externalId ?? null });
  await emit(tenant.id, "call.received", { contactId: contact.id, status: parsed.data.status, externalId: parsed.data.externalId ?? null });

  if (parsed.data.status === "answered") return NextResponse.json({ received: true, outcome: "logged" });

  const raised = await raiseMissedOpportunity(tenant, {
    type: "MISSED_CALL",
    leadId: null,
    contactId: contact.id,
    subjectId: parsed.data.externalId ?? `${contact.id}:${new Date().toISOString().slice(0, 13)}`,
    summary: `${leadDisplayName(contact)} called and nobody answered${parsed.data.transcription ? ` (voicemail: "${parsed.data.transcription.slice(0, 120)}")` : ""}.`,
    suggestedAction: "Call back within the hour. A text with a booking link has gone out if the workspace has that on.",
    confidence: 0.8,
  });
  await onMissedCall(tenant, contact);
  return NextResponse.json({ received: true, outcome: raised ? "raised" : "already_open" });
}
