import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { processIntake } from "@/lib/intake/process";
import { clientIpFromHeaders } from "@/lib/auth/client-ip";
import { takeIntakeTokens } from "@/lib/intake/rate-limit";
import { INTAKE_MAX_BODY_BYTES, intakeSchema } from "@/lib/intake/schema";
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

  const limit = await takeIntakeTokens([auth.tenant.id, `ip:${clientIpFromHeaders((n) => req.headers.get(n))}`]);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests for this workspace. Slow down and retry." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > INTAKE_MAX_BODY_BYTES) {
    return NextResponse.json({ error: `Body too large (max ${INTAKE_MAX_BODY_BYTES} bytes).` }, { status: 413 });
  }

  let raw: unknown;
  try {
    const bytes = await req.arrayBuffer();
    if (bytes.byteLength > INTAKE_MAX_BODY_BYTES) {
      return NextResponse.json({ error: `Body too large (max ${INTAKE_MAX_BODY_BYTES} bytes).` }, { status: 413 });
    }
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const parsed = intakeSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid intake payload.", issues: z.flattenError(parsed.error).fieldErrors }, { status: 422 });
  }

  const rawPayload = (raw && typeof raw === "object" ? raw : { value: raw }) as Record<string, unknown>;

  try {
    // Namespace caller-chosen ids so a relay cannot pre-empt a Meta or email lead's id.
    const body = parsed.data.externalId ? { ...parsed.data, externalId: `api:${auth.apiKeyId ?? auth.tenant.id}:${parsed.data.externalId}` } : parsed.data;
    const result = await processIntake(auth.tenant, body, rawPayload);

    if (result.outcome === "dry_run") {
      return NextResponse.json({ outcome: "dry_run", tenant: auth.tenant.slug, qualification: result.qualification });
    }
    if (result.outcome === "capped") {
      return NextResponse.json({ error: "This workspace has reached its daily limit of enquiries." }, { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } });
    }
    if (result.outcome === "duplicate") {
      return NextResponse.json({ outcome: "duplicate", tenant: auth.tenant.slug, leadId: result.lead.id, ticketType: result.lead.ticketType });
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
        bookingUrl: result.bookingUrl,
      },
      { status: 201 },
    );
  } catch (error) {
    // Never log payloads here: a validation error from the ORM can echo the data it was given.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[intake] failed for tenant ${auth.tenant.slug}: ${message}`);
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
