import type { Permission, TenantAccess } from "@/lib/types";

export class ForbiddenError extends Error {
  constructor(message = "You don’t have permission to do that in this workspace.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function hasPermission(access: Pick<TenantAccess, "permissions" | "via">, permission: Permission): boolean {
  // Operators and platform admins act with every permission inside tenants they can reach.
  if (access.via === "operator" || access.via === "admin") return true;
  return access.permissions.includes(permission);
}

export function requirePermission(access: Pick<TenantAccess, "permissions" | "via">, permission: Permission): void {
  if (!hasPermission(access, permission)) throw new ForbiddenError();
}

/** Default role templates seeded for every tenant. Tenants rename them freely. */
export const ROLE_TEMPLATES: { key: string; name: string; permissions: Permission[] }[] = [
  { key: "owner", name: "Owner", permissions: ["VIEW_FINANCES", "APPROVE_CONTENT", "RECEIVE_LEAD_ALERTS", "MANAGE_USERS", "VIEW_ALL_RECORDS"] },
  { key: "manager", name: "Manager", permissions: ["APPROVE_CONTENT", "RECEIVE_LEAD_ALERTS", "MANAGE_USERS", "VIEW_ALL_RECORDS"] },
  { key: "staff", name: "Staff", permissions: ["RECEIVE_LEAD_ALERTS"] },
  { key: "accountant", name: "External accountant", permissions: ["VIEW_FINANCES"] },
];
