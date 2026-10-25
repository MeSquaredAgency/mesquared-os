import { NextRequest, NextResponse } from "next/server";
import { repository } from "@/lib/data";
import { processIntake } from "@/lib/intake/process";
import { ATTRIBUTION_COOKIE, parseAttributionCookie } from "@/lib/attribution/links";
import { clientIpFromHeaders } from "@/lib/auth/client-ip";
import { takeIntakeTokens } from "@/lib/intake/rate-limit";
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

  const ip = clientIpFromHeaders((n) => req.headers.get(n));
  const limit = await takeIntakeTokens([auth.tenant.id, `ip:${ip}`]);
  if (!limit.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });

  // Redirect only back to the site the form lives on (the page that posted, or the tenant's connected website).
  const redirect = get("_redirect");
  const website = await repository.findIntegration(auth.tenant.id, "WEBSITE");
  const allowedHosts = new Set<string>();
  try {
    const referer = req.headers.get("referer");
    if (referer) allowedHosts.add(new URL(referer).host);
  } catch {}
  if (typeof website?.settings.domain === "string") allowedHosts.add(website.settings.domain);
  const finish = (ok: boolean, body: Record<string, unknown>, status = 200) => {
    if (redirect && /^https?:\/\//.test(redirect)) {
      try {
        const url = new URL(redirect);
        if (allowedHosts.has(url.host)) {
          url.searchParams.set("submitted", ok ? "1" : "0");
          return NextResponse.redirect(url, 303);
        }
      } catch {}
    }
    return NextResponse.json(body, { status });
  };

  // Honeypot: bots fill every field. Pretend success and store nothing.
  if (get("_hp")) return finish(true, { outcome: "ignored" });

  const reserved = new Set(["_key", "_redirect", "_hp", "_session", "name", "first_name", "last_name", "firstName", "lastName", "email", "phone", "company", "message", "source", "external_id"]);
  const fields: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (!reserved.has(k) && typeof v === "string" && v) fields[k] = v;
  // A tracked-link cookie fills in the campaign when the form itself carried no UTMs.
  for (const [k, v] of Object.entries(parseAttributionCookie(req.cookies.get(ATTRIBUTION_COOKIE)?.value))) if (!fields[k]) fields[k] = v;

  const parsed = intakeSchema.safeParse({
    source: get("source") ?? "WEB_FORM",
    externalId: get("external_id") ? `form:${auth.apiKeyId ?? auth.tenant.id}:${get("external_id")}` : null,
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
    if (result.outcome === "capped") return finish(false, { error: "Too many enquiries today. Please try again tomorrow or call us." }, 429);
    if (session) await repository.updateFormSession(auth.tenant.id, session, { submittedAt: new Date(), ...(result.outcome === "created" || result.outcome === "duplicate" ? { convertedLeadId: result.lead.id } : {}) });
    let path: string | null = null;
    try {
      path = req.headers.get("referer") ? new URL(req.headers.get("referer")!).pathname : null;
    } catch {}
    await repository.recordWebEvents(auth.tenant.id, [{ kind: "FORM_SUBMIT", path, referrer: null, source: fields.utm_source?.toLowerCase() ?? null, sessionKey: session ?? null }]).catch(() => {});
    return finish(true, { outcome: result.outcome }, result.outcome === "created" ? 201 : 200);
  } catch (error) {
    console.error(`[intake/form] failed for ${auth.tenant.slug}: ${error instanceof Error ? error.message : error}`);
    return finish(false, { error: "Something went wrong. Please try again." }, 500);
  }
}
