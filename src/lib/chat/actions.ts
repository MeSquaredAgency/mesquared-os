"use server";

import { revalidatePath } from "next/cache";
import { getPortalContext } from "@/lib/auth/access";
import { displayName, sideOf } from "@/lib/collab/people";
import { postChatMessage } from "./index";

export async function sendChatAction(slug: string, text: string): Promise<{ ok: boolean; message: string }> {
  try {
    const { access, user } = await getPortalContext(slug);
    await postChatMessage({ tenant: access.tenant, authorId: user.id, authorName: displayName(user), side: sideOf(access), text });
    revalidatePath(`/app/${slug}/messages`);
    revalidatePath(`/console/${slug}/messages`);
    return { ok: true, message: "Sent." };
  } catch (error) {
    const known = error instanceof Error && /^(Write a message|Messages are limited)/.test(error.message);
    if (!known) console.error("[chat] send failed", error instanceof Error ? error.message : error);
    return { ok: false, message: known ? (error as Error).message : "Your message couldn't be sent. Please try again." };
  }
}
