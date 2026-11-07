"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { repository } from "@/lib/data";
import { isPushEndpoint, pushToPeople, vapidKeys } from "./index";

/** The public key a browser subscribes with, or null when push is not set up on this deployment. */
export async function pushPublicKey(): Promise<string | null> {
  await requireUser();
  return (await vapidKeys())?.publicKey ?? null;
}

const Subscription = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().min(80).max(120), auth: z.string().min(16).max(40) }),
  device: z.string().max(60).optional(),
});

export async function savePushSubscriptionAction(raw: unknown): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser();
  const parsed = Subscription.safeParse(raw);
  if (!parsed.success || !isPushEndpoint(parsed.data.endpoint)) return { ok: false, message: "This browser's notification address wasn't recognised." };
  await repository.savePushSubscription(user.id, { endpoint: parsed.data.endpoint, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth, device: parsed.data.device ?? null });
  return { ok: true, message: "Notifications are on for this device." };
}

export async function deletePushSubscriptionAction(endpoint: string): Promise<{ ok: boolean }> {
  const user = await requireUser();
  await repository.deletePushSubscription(String(endpoint).slice(0, 1000), user.id);
  return { ok: true };
}

export async function sendTestPushAction(): Promise<{ ok: boolean; message: string }> {
  const user = await requireUser();
  const reached = await pushToPeople([user.id], { title: "Notifications are on", body: "This is how new messages and task reminders will reach you.", url: "/", tag: "test" });
  return reached.has(user.id) ? { ok: true, message: "Sent. It should appear in a moment." } : { ok: false, message: "It couldn't be delivered. Try turning notifications off and on again." };
}
