import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth/session";
import { repository } from "@/lib/data";
import type { TenantSummary, UserRecord } from "@/lib/types";

export const TENANT_COOKIE = "msq_tenant";

/**
 * Resolves the signed-in operator and the tenant they are currently viewing.
 * Only tenants the user is a member of (or all, for platform admins) are
 * offered; a stale cookie pointing elsewhere falls back to the first allowed.
 */
export async function getCurrentTenant(): Promise<{ user: UserRecord; tenant: TenantSummary; tenants: TenantSummary[] }> {
  const user = await requireUser();
  const tenants = await repository.listTenantsForUser(user.id);
  if (tenants.length === 0) {
    throw new Error(`${user.email} has no workspace access. Add a Membership row for this user.`);
  }
  const store = await cookies();
  const wanted = store.get(TENANT_COOKIE)?.value;
  const tenant = tenants.find((t) => t.id === wanted || t.slug === wanted) ?? tenants[0];
  return { user, tenant, tenants };
}
