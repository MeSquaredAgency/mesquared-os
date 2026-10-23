import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { repository } from "@/lib/data";
import { emit } from "@/lib/events";
import { leadDisplayName } from "@/lib/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/webhooks/calcom
 *
 * Cal.com booking events. The booking page is created with
 * metadata[leadId] and metadata[tenant], so the payload tells us which lead
 * booked. Signature: HMAC-SHA256 of the raw body with CALCOM_WEBHOOK_SECRET
 * in `x-cal-signature-256`.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const secret = process.env.CALCOM_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers.get("x-cal-signature-256") ?? "";
    const expected = createHmac("sha256", secret).update(raw).digest("hex");
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return NextResponse.json({ error: "Bad signature." }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "CALCOM_WEBHOOK_SECRET is not configured." }, { status: 503 });
  }

  let event: { triggerEvent?: string; payload?: { uid?: string; startTime?: string; endTime?: string; metadata?: Record<string, unknown> } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const meta = event.payload?.metadata ?? {};
  const leadId = typeof meta.leadId === "string" ? meta.leadId : null;
  const slug = typeof meta.tenant === "string" ? meta.tenant : null;
  if (!leadId || !slug) return NextResponse.json({ received: true, ignored: "no lead metadata" });

  const tenant = await repository.findTenantBySlug(slug);
  if (!tenant) return NextResponse.json({ received: true, ignored: "unknown tenant" });

  if (event.triggerEvent === "BOOKING_CREATED" || event.triggerEvent === "BOOKING_RESCHEDULED") {
    const when = event.payload?.startTime ? new Date(event.payload.startTime) : new Date();
    const lead = await repository.markLeadBooked(tenant.id, leadId, when);
    if (lead) {
      await repository.recordAutomationRun(tenant.id, { typeKey: "booking_lifecycle", outcome: "COMPLETED", summary: `${leadDisplayName(lead)} booked a time${event.payload?.startTime ? ` for ${when.toLocaleString("en-AU", { timeZone: tenant.timezone, dateStyle: "medium", timeStyle: "short" })}` : ""}.`, leadId: lead.id, contactId: lead.contactId, details: { bookingUid: event.payload?.uid ?? null } });
      await emit(tenant.id, "booking.created", { leadId: lead.id, startsAt: when.toISOString(), provider: "CALCOM" });
      // A lead that booked is no longer a "never booked" missed opportunity.
      const open = await repository.listMissedOpportunities(tenant.id, { status: ["DETECTED", "RECOVERING", "ESCALATED"], limit: 500 });
      for (const m of open.filter((x) => x.leadId === lead.id && x.type === "NOT_BOOKED")) {
        await repository.resolveMissedOpportunity(tenant.id, m.id, "RECOVERED", m.estimatedValueCents);
      }
    }
  }
  return NextResponse.json({ received: true });
}
