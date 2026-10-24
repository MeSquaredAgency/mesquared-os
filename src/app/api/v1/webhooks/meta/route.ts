import { NextResponse, type NextRequest } from "next/server";
import { decryptSecret } from "@/lib/crypto";
import { repository } from "@/lib/data";
import { fetchMetaLead, mapMetaFieldData, parseMetaLeadgenEvents, verifyMetaSignature } from "@/lib/intake/channels/meta";
import { processIntake } from "@/lib/intake/process";
import { intakeSchema } from "@/lib/intake/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET: Meta's verification handshake. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (p.get("hub.mode") === "subscribe" && p.get("hub.challenge")) {
    const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (expected && p.get("hub.verify_token") === expected) return new NextResponse(p.get("hub.challenge"), { status: 200 });
    return NextResponse.json({ error: "Verify token mismatch." }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * POST: leadgen events. The page id resolves the tenant through its META
 * integration; the page access token (encrypted on that integration) fetches
 * the answers; the result goes through the normal intake pipeline, which
 * dedupes on the leadgen id.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const appSecret = process.env.META_APP_SECRET;
  if (appSecret) {
    if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), appSecret)) return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "META_APP_SECRET is not configured." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const events = parseMetaLeadgenEvents(body);
  const results: { leadgenId: string; outcome: string }[] = [];
  for (const ev of events) {
    const tenant = await repository.findTenantByIntegrationAccount("META", ev.pageId);
    if (!tenant) {
      results.push({ leadgenId: ev.leadgenId, outcome: "unknown_page" });
      continue;
    }
    try {
      const integration = await repository.findIntegration(tenant.id, "META");
      const token = integration?.credentialsEnc ? decryptSecret(integration.credentialsEnc, integration.id) : process.env.META_PAGE_ACCESS_TOKEN;
      if (!token) {
        results.push({ leadgenId: ev.leadgenId, outcome: "no_token" });
        continue;
      }
      const lead = await fetchMetaLead(ev.leadgenId, token);
      const mapped = mapMetaFieldData(lead.fieldData);
      const parsed = intakeSchema.safeParse({
        source: "META_LEAD_FORM",
        externalId: `meta:${ev.leadgenId}`,
        name: mapped.name,
        firstName: mapped.firstName,
        lastName: mapped.lastName,
        email: mapped.email,
        phone: mapped.phone,
        message: mapped.fields.message ?? mapped.fields.comments ?? null,
        fields: { ...mapped.fields, utm_source: "facebook", utm_medium: "lead_form", ...(ev.adId ? { utm_content: ev.adId } : {}), ...(ev.formId ? { form_id: ev.formId } : {}) },
      });
      if (!parsed.success) {
        results.push({ leadgenId: ev.leadgenId, outcome: "invalid" });
        continue;
      }
      const result = await processIntake(tenant, parsed.data, { meta: ev, field_data: lead.fieldData }, { channel: "META_LEAD_FORM", provider: "META" });
      results.push({ leadgenId: ev.leadgenId, outcome: result.outcome });
    } catch (error) {
      console.error(`[webhooks/meta] lead ${ev.leadgenId} failed: ${error instanceof Error ? error.message : error}`);
      results.push({ leadgenId: ev.leadgenId, outcome: "error" });
    }
  }
  // Always 200 so Meta does not retry forever; failures are in our logs and the exception queue.
  return NextResponse.json({ received: events.length, results });
}
