import { NextResponse, type NextRequest } from "next/server";
import { repository } from "@/lib/data";
import { parseMetaLeadgenEvents, verifyMetaSignature } from "@/lib/intake/channels/meta";
import { ingestMetaLead } from "@/lib/intake/channels/meta-lead";
import { ingestMetaWebhookInbox } from "@/lib/social/meta-webhook";

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
      results.push({ leadgenId: ev.leadgenId, outcome: await ingestMetaLead(tenant, ev) });
    } catch (error) {
      // Only the intake pipeline itself can throw here (a Graph failure is already queued for retry); the lead is still
      // deduped on its leadgen id, so a later retry from Meta or the queue is safe.
      console.error(`[webhooks/meta] lead ${ev.leadgenId} failed: ${error instanceof Error ? error.message : error}`);
      results.push({ leadgenId: ev.leadgenId, outcome: "error" });
    }
  }
  // Comments, Messenger messages and Instagram comments and DMs go to the unified inbox.
  // `page` webhooks name the Facebook page; `instagram` webhooks name the IG business account.
  const { inboxNew } = await ingestMetaWebhookInbox(body);
  // Always 200 so Meta does not retry forever; a lead that could not be fetched is queued for our own retry and,
  // failing that, lands in the exception queue.
  return NextResponse.json({ received: events.length, inbox: inboxNew, results });
}
