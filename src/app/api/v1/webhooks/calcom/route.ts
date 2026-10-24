import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { registerAutomations } from "@/lib/automations/handlers";
import { repository } from "@/lib/data";
import { emit } from "@/lib/events";
import { leadDisplayName } from "@/lib/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CalEvent {
  triggerEvent?: string;
  payload?: { uid?: string; startTime?: string; endTime?: string; metadata?: Record<string, unknown>; noShowHost?: boolean; attendees?: { noShow?: boolean }[] };
}

/**
 * POST /api/v1/webhooks/calcom
 *
 * Cal.com booking events. The booking page is created with metadata[leadId]
 * and metadata[tenant], so the payload tells us which lead booked. Signature:
 * HMAC-SHA256 of the raw body with CALCOM_WEBHOOK_SECRET in x-cal-signature-256.
 */
export async function POST(req: NextRequest) {
  registerAutomations();
  const raw = await req.text();
  const secret = process.env.CALCOM_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers.get("x-cal-signature-256") ?? "";
    const expected = createHmac("sha256", secret).update(raw).digest("hex");
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return NextResponse.json({ error: "Bad signature." }, { status: 401 });
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "CALCOM_WEBHOOK_SECRET is not configured." }, { status: 503 });
  }

  let event: CalEvent;
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
  const lead = await repository.findLeadById(tenant.id, leadId);
  if (!lead) return NextResponse.json({ received: true, ignored: "unknown lead" });

  const startsAt = event.payload?.startTime ? new Date(event.payload.startTime) : null;
  const endsAt = event.payload?.endTime ? new Date(event.payload.endTime) : null;
  const uid = event.payload?.uid ?? null;
  const existing = await repository.findLatestBookingForLead(tenant.id, lead.id);

  switch (event.triggerEvent) {
    case "BOOKING_CREATED":
    case "BOOKING_RESCHEDULED": {
      const booking = existing ? await repository.updateBooking(tenant.id, existing.id, { status: "SCHEDULED", startsAt, endsAt, externalId: uid }) : null;
      const bookingId = booking?.id ?? (await repository.createBooking(tenant.id, { leadId: lead.id, bookingUrl: "", sent: true })).id;
      if (!booking) await repository.updateBooking(tenant.id, bookingId, { status: "SCHEDULED", startsAt, endsAt, externalId: uid });
      await repository.markLeadBooked(tenant.id, lead.id, startsAt ?? new Date());
      if (event.triggerEvent === "BOOKING_RESCHEDULED") await repository.cancelActions(tenant.id, `booking:${bookingId}:`);
      await repository.recordAutomationRun(tenant.id, { typeKey: "booking_lifecycle", outcome: "COMPLETED", summary: `${leadDisplayName(lead)} ${event.triggerEvent === "BOOKING_RESCHEDULED" ? "moved their appointment to" : "booked a time for"} ${startsAt ? startsAt.toLocaleString(tenant.locale, { timeZone: tenant.timezone, dateStyle: "medium", timeStyle: "short" }) : "a new time"}.`, leadId: lead.id, contactId: lead.contactId, details: { bookingUid: uid } });
      await emit(tenant.id, "booking.created", { bookingId, leadId: lead.id, startsAt: startsAt?.toISOString() ?? null, endsAt: endsAt?.toISOString() ?? null, provider: "CALCOM" });
      const open = await repository.listMissedOpportunities(tenant.id, { status: ["DETECTED", "RECOVERING", "ESCALATED"], limit: 500 });
      for (const m of open.filter((x) => x.leadId === lead.id && (x.type === "NOT_BOOKED" || x.type === "NO_SHOW"))) {
        await repository.resolveMissedOpportunity(tenant.id, m.id, "RECOVERED", m.estimatedValueCents);
      }
      return NextResponse.json({ received: true, bookingId });
    }
    case "BOOKING_CANCELLED": {
      if (existing) {
        await repository.updateBooking(tenant.id, existing.id, { status: "CANCELLED" });
        await repository.cancelActions(tenant.id, `booking:${existing.id}:`);
        await repository.recordAutomationRun(tenant.id, { typeKey: "booking_lifecycle", outcome: "COMPLETED", summary: `${leadDisplayName(lead)} cancelled their appointment.`, leadId: lead.id, contactId: lead.contactId });
        await emit(tenant.id, "booking.cancelled", { bookingId: existing.id, leadId: lead.id });
      }
      return NextResponse.json({ received: true });
    }
    case "BOOKING_NO_SHOW_UPDATED": {
      const noShow = event.payload?.attendees?.some((a) => a.noShow) ?? false;
      if (existing && noShow) {
        await repository.updateBooking(tenant.id, existing.id, { status: "NO_SHOW" });
        await repository.cancelActions(tenant.id, `booking:${existing.id}:`);
        await emit(tenant.id, "booking.no_show", { bookingId: existing.id, leadId: lead.id });
      }
      return NextResponse.json({ received: true });
    }
    default:
      return NextResponse.json({ received: true, ignored: event.triggerEvent ?? "unknown event" });
  }
}
