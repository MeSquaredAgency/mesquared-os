import { NextResponse, type NextRequest } from "next/server";
import { ATTRIBUTION_COOKIE, attributionCookieValue, destinationWithUtms } from "@/lib/attribution/links";
import { repository } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /r/<code> — a tracked link. Counts the click, records it for the
 * website numbers, drops a first-party attribution cookie (so a form filled
 * later still carries the campaign), and sends the person on with UTMs.
 * Unknown codes go to the platform home rather than a dead end.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const link = await repository.findTrackedLinkByCode(code.toLowerCase());
  if (!link) return NextResponse.redirect(new URL("/", req.url), 302);
  await Promise.all([repository.incrementTrackedLinkClicks(link.id), repository.recordWebEvents(link.tenantId, [{ kind: "LINK_CLICK", path: `/r/${link.code}`, referrer: req.headers.get("referer"), source: link.source }])]).catch(() => {});
  const res = NextResponse.redirect(destinationWithUtms(link), 302);
  // Cross-site so the tenant's own form page can send it back to our API.
  res.cookies.set(ATTRIBUTION_COOKIE, attributionCookieValue(link), { maxAge: 30 * 86_400, httpOnly: true, sameSite: "none", secure: true, path: "/" });
  return res;
}
