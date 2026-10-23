import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth/session";
import { repository } from "@/lib/data";
import type { TenantAccess, UserRecord } from "@/lib/types";

export const TENANT_COOKIE = "msq_tenant";

/** Thrown when a signed-in user has no workspace memberships. */
export class NoWorkspaceAccessError extends Error {
  constructor(public readonly email: string) {
    super(`${email} has no workspace access. Add a Membership row for this user.`);
    this.name = "NoWorkspaceAccessError";
  }
}

/**
 * Resolves the signed-in operator and the tenant they are currently viewing,
 * including their role in it. Only tenants the user is a member of (or all,
 * for platform admins) are offered; a stale cookie falls back to the first.
 */
export async function getCurrentTenant(): Promise<{ user: UserRecord; tenant: TenantAccess; tenants: TenantAccess[] }> {
  const user = await requireUser();
  const tenants = await repository.listTenantsForUser(user.id);
  if (tenants.length === 0) throw new NoWorkspaceAccessError(user.email);
  const store = await cookies();
  const wanted = store.get(TENANT_COOKIE)?.value;
  const tenant = tenants.find((t) => t.id === wanted || t.slug === wanted) ?? tenants[0];
  return { user, tenant, tenants };
}
