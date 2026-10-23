"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { TENANT_COOKIE } from "./current";

export async function switchTenant(tenantId: string) {
  const store = await cookies();
  store.set(TENANT_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath("/", "layout");
}
