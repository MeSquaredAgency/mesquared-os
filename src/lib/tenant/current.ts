import { cookies } from "next/headers";
import { repository } from "@/lib/data";
import type { TenantSummary } from "@/lib/types";

export const TENANT_COOKIE = "msq_tenant";

/**
 * Resolves the tenant the operator is currently viewing in the dashboard.
 * Falls back to the first tenant they can access when the cookie is missing
 * or stale.
 */
export async function getCurrentTenant(): Promise<{ tenant: TenantSummary; tenants: TenantSummary[] }> {
  const tenants = await repository.listTenants();
  if (tenants.length === 0) {
    throw new Error("No tenants exist. Run `npm run db:seed` or create a tenant first.");
  }
  const store = await cookies();
  const wanted = store.get(TENANT_COOKIE)?.value;
  const tenant = tenants.find((t) => t.id === wanted || t.slug === wanted) ?? tenants[0];
  return { tenant, tenants };
}
