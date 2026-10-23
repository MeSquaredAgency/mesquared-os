import type { MembershipRole } from "@/lib/types";

/** Ordered from most to least privileged. */
const RANK: Record<MembershipRole, number> = { OWNER: 4, ADMIN: 3, OPERATOR: 2, MARKETING: 1, VIEWER: 0 };

export class ForbiddenError extends Error {
  constructor(message = "You don’t have permission to do that in this workspace.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function hasRole(role: MembershipRole, allowed: MembershipRole[]): boolean {
  return allowed.includes(role);
}

/** True when `role` is at least as privileged as `minimum`. */
export function atLeast(role: MembershipRole, minimum: MembershipRole): boolean {
  return RANK[role] >= RANK[minimum];
}

export function requireRole(role: MembershipRole, allowed: MembershipRole[]): void {
  if (!hasRole(role, allowed)) throw new ForbiddenError();
}
