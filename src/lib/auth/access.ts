import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { repository } from "@/lib/data";
import type { TenantAccess, UserRecord } from "@/lib/types";
import { requireUser } from "./session";

export interface PortalContext {
  user: UserRecord;
  access: TenantAccess;
  /** Every tenant the user can open, for the workspace switcher. */
  tenants: TenantAccess[];
}

export interface ConsoleContext {
  user: UserRecord;
  /** Tenants in the operator's portfolio (assigned, or all for platform admins). */
  tenants: TenantAccess[];
}

/** Where a signed-in user lands: operators in the console, everyone else in their first workspace. */
export async function homePathFor(user: UserRecord): Promise<string> {
  if (user.isOperator || user.isPlatformAdmin) return "/console";
  const tenants = await repository.listTenantAccess(user.id);
  return tenants[0] ? `/app/${tenants[0].tenant.slug}` : "/no-access";
}

/** Resolves the signed-in user and their access to the tenant in the URL. 404s when they cannot reach it. */
export async function getPortalContext(slug: string): Promise<PortalContext> {
  const user = await requireUser();
  const tenants = await repository.listTenantAccess(user.id);
  const access = tenants.find((t) => t.tenant.slug === slug);
  if (!access) notFound();
  return { user, access, tenants };
}

/** Operators only; tenant users are sent to their portal. */
export async function getConsoleContext(): Promise<ConsoleContext> {
  const user = await requireUser();
  if (!user.isOperator && !user.isPlatformAdmin) redirect(await homePathFor(user));
  const tenants = await repository.listTenantAccess(user.id);
  return { user, tenants };
}
