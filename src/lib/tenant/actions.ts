"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import { repository } from "@/lib/data";
import { TENANT_COOKIE } from "./current";

/**
 * Switches the operator's current workspace. The target must be one the
 * signed-in user is a member of; anything else is ignored.
 */
export async function switchTenant(tenantId: string) {
  const user = await getCurrentUser();
  if (!user) return;
  const allowed = await repository.listTenantsForUser(user.id);
  if (!allowed.some((t) => t.id === tenantId)) return;

  const store = await cookies();
  store.set(TENANT_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}
