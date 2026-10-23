import { NextResponse, type NextRequest } from "next/server";
import { processIntake } from "@/lib/intake/process";
import { intakeSchema } from "@/lib/intake/schema";
import { resolveTenantFromRequest } from "@/lib/tenant/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/intake
 *
 * Receives a lead from any external source (web form, landing page, ad lead
 * form relay), authenticates the tenant by API key, runs the Green/Red
 * qualification engine and routes the lead.
 *
 * Headers:  Authorization: Bearer <tenant api key>   (or x-api-key)
 * Body:     see src/lib/intake/schema.ts
 */
export async function POST(req: NextRequest) {
  const auth = await resolveTenantFromRequest(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const parsed = intakeSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid intake payload.", issues: parsed.error.flatten().fieldErrors },
      { status: 422 },
    );
  }

  const rawPayload = (raw && typeof raw === "object" ? raw : { value: raw }) as Record<string, unknown>;

  try {
    const result = await processIntake(auth.tenant, parsed.data, rawPayload);

    if (result.outcome === "dry_run") {
      return NextResponse.json({ outcome: "dry_run", tenant: auth.tenant.slug, qualification: result.qualification });
    }
    if (result.outcome === "duplicate") {
      return NextResponse.json(
        { outcome: "duplicate", tenant: auth.tenant.slug, leadId: result.lead.id, ticketType: result.lead.ticketType },
        { status: 200 },
      );
    }
    return NextResponse.json(
      {
        outcome: "created",
        tenant: auth.tenant.slug,
        leadId: result.lead.id,
        ticketType: result.qualification.ticketType,
        intentScore: result.qualification.intentScore,
        reason: result.qualification.reason,
        classifier: result.qualification.classifier,
        taskId: result.taskId,
        bookingUrl: result.bookingUrl,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[intake] failed", error);
    return NextResponse.json({ error: "Intake failed. The lead was not stored." }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/v1/intake",
    method: "POST",
    auth: "Authorization: Bearer <tenant api key>",
    body: {
      source: "WEB_FORM | LANDING_PAGE | META_LEAD_FORM | TIKTOK_LEAD_FORM | LINKEDIN_LEAD_FORM | …",
      externalId: "optional idempotency key",
      name: "or firstName/lastName",
      email: "required unless phone",
      phone: "required unless email",
      company: "optional",
      message: "optional",
      fields: { budget: "optional", timeline: "optional", service: "optional" },
      dryRun: false,
    },
  });
}
