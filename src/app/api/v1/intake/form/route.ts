import { NextRequest, NextResponse } from "next/server";
import { repository } from "@/lib/data";
import { processIntake } from "@/lib/intake/process";
import { takeIntakeToken } from "@/lib/intake/rate-limit";
import { intakeSchema } from "@/lib/intake/schema";
import { resolveTenantFromRequest } from "@/lib/tenant/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/intake/form
 *
 * Plain HTML forms (website contact forms, Google Ads landing pages) post
 * here as application/x-www-form-urlencoded or multipart. The tenant key
 * goes in a hidden `_key` field (or the usual headers); UTM fields and
 * click ids are captured for attribution; `_hp` is a honeypot that must stay
 * empty; `_redirect` is a same-origin or absolute thank-you URL.
 */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected a form submission." }, { status: 400 });

  const get = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : null;
  };

  const keyFromForm = get("_key");
  const authReq = keyFromForm ? new NextRequest(req.url, { headers: { "x-api-key": keyFromForm } }) : req;
  const auth = await resolveTenantFromRequest(authReq);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const limit = takeIntakeToken(auth.tenant.id);
  if (!limit.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });

  const redirect = get("_redirect");
  const finish = (ok: boolean, body: Record<string, unknown>, status = 200) => {
    if (redirect && /^https?:\/\//.test(redirect)) {
      const url = new URL(redirect);
      url.searchParams.set("submitted", ok ? "1" : "0");
      return NextResponse.redirect(url, 303);
    }
    return NextResponse.json(body, { status });
  };

  // Honeypot: bots fill every field. Pretend success and store nothing.
  if (get("_hp")) return finish(true, { outcome: "ignored" });

  const reserved = new Set(["_key", "_redirect", "_hp", "_session", "name", "first_name", "last_name", "firstName", "lastName", "email", "phone", "company", "message", "source", "external_id"]);
  const fields: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (!reserved.has(k) && typeof v === "string" && v) fields[k] = v;

  const parsed = intakeSchema.safeParse({
    source: get("source") ?? "WEB_FORM",
    externalId: get("external_id"),
    name: get("name"),
    firstName: get("first_name") ?? get("firstName"),
    lastName: get("last_name") ?? get("lastName"),
    email: get("email"),
    phone: get("phone"),
    company: get("company"),
    message: get("message"),
    fields: { ...fields, referer: req.headers.get("referer") ?? "" },
  });
  if (!parsed.success) return finish(false, { error: "Please check the form: we need at least an email address or a phone number." }, 422);

  try {
    const result = await processIntake(auth.tenant, parsed.data, Object.fromEntries([...form.entries()].filter(([k]) => k !== "_key").map(([k, v]) => [k, typeof v === "string" ? v : "(file)"])), { channel: "WEB_FORM", provider: fields.utm_source || "website" });
    const session = get("_session");
    if (session) await repository.updateFormSession(auth.tenant.id, session, { submittedAt: new Date(), ...(result.outcome !== "dry_run" ? { convertedLeadId: result.lead.id } : {}) });
    return finish(true, { outcome: result.outcome }, result.outcome === "created" ? 201 : 200);
  } catch (error) {
    console.error(`[intake/form] failed for ${auth.tenant.slug}: ${error instanceof Error ? error.message : error}`);
    return finish(false, { error: "Something went wrong. Please try again." }, 500);
  }
}
