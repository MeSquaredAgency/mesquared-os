import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * GET  /api/v1/webhooks/social-leads — Meta webhook verification handshake.
 * POST /api/v1/webhooks/social-leads — Meta / TikTok / LinkedIn lead-form events.
 *
 * Stub. Each platform adapter will normalise its payload into the intake
 * schema and hand it to `processIntake` for the owning tenant.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  if (params.get("hub.mode") === "subscribe" && params.get("hub.challenge")) {
    // TODO: compare hub.verify_token with the tenant's configured token.
    return new NextResponse(params.get("hub.challenge"), { status: 200 });
  }
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  console.info("[webhooks/social-leads] received", { bytes: body.length });
  return NextResponse.json({ received: true, implemented: false }, { status: 202 });
}
