import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { hasPermission } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/lib/auth/session";
import { repository } from "@/lib/data";
import { isRealtimeConfigured, sealLeadsQuery } from "@/lib/realtime/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ tenant: z.string().min(1).max(100), userId: z.string().min(1).max(100) });

/**
 * POST /api/v1/live/leads — renews the sealed live query for the portal's
 * lead list. Session cookie required; the page sends the user it was rendered
 * for, and a different session gets a 401 so the page reloads instead of
 * showing one person's rows to another.
 */
export async function POST(req: NextRequest) {
  if (!isRealtimeConfigured()) return NextResponse.json({ error: "Realtime is not configured." }, { status: 503 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Expected { tenant, userId }." }, { status: 400 });
  const user = await getCurrentUser();
  if (!user || user.id !== parsed.data.userId) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const access = (await repository.listTenantAccess(user.id)).find((t) => t.tenant.slug === parsed.data.tenant);
  if (!access) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const onlyAssigneeId = hasPermission(access, "VIEW_ALL_RECORDS") ? null : user.id;
  return NextResponse.json(await sealLeadsQuery(access.tenant.id, { onlyAssigneeId }));
}
