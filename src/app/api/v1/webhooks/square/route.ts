import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/v1/webhooks/square
 *
 * Stub. The Square integration will: verify the signature against the
 * tenant's `webhookSignatureKey`, resolve the tenant from the merchant id,
 * upsert the Transaction, and advance the matching Lead to WON on
 * `payment.completed`.
 */
export async function POST(req: NextRequest) {
  const signature = req.headers.get("x-square-hmacsha256-signature");
  const body = await req.text();
  console.info("[webhooks/square] received", { signaturePresent: Boolean(signature), bytes: body.length });
  return NextResponse.json({ received: true, implemented: false }, { status: 202 });
}
