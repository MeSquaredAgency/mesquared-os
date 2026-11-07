import { repository } from "@/lib/data";
import { errorText, log } from "@/lib/log";
import { generateVapidKeys, sendWebPush, type VapidKeys } from "./webpush";

/**
 * Browser and phone notifications. Keys come from VAPID_PUBLIC_KEY and
 * VAPID_PRIVATE_KEY (make a pair with `npm run push:keys`). Without them,
 * development makes a pair for the life of the process; production simply
 * has no push, and callers fall back to email.
 */
let devKeys: Promise<VapidKeys> | null = null;

export async function vapidKeys(): Promise<VapidKeys | null> {
  const subject = process.env.VAPID_SUBJECT || `mailto:${process.env.DEFAULT_FROM_EMAIL || "hello@mesquaredagency.com"}`;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (publicKey && privateKey) return { publicKey, privateKey, subject };
  if (process.env.NODE_ENV === "production") return null;
  devKeys ??= generateVapidKeys().then((k) => ({ ...k, subject }));
  return devKeys;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Where a tap opens, inside the OS. */
  url: string;
  /** Notifications with the same tag replace each other on the device: one per chat, one per task. */
  tag?: string;
}

/**
 * Sends to every device each person has turned notifications on for, and
 * returns the people reached on at least one. Devices the push service says
 * are gone are forgotten; other failures are logged and the person counts as
 * not reached, so the caller can fall back to email.
 */
export async function pushToPeople(userIds: string[], message: PushMessage, opts: { urgency?: "normal" | "high" } = {}): Promise<Set<string>> {
  const reached = new Set<string>();
  if (userIds.length === 0) return reached;
  const keys = await vapidKeys();
  if (!keys) return reached;
  const subs = await repository.listPushSubscriptions([...new Set(userIds)]);
  const payload = JSON.stringify({ title: message.title.slice(0, 120), body: message.body.slice(0, 240), url: message.url.startsWith("/") ? message.url : "/", tag: message.tag });
  await Promise.all(
    subs.map(async (sub) => {
      try {
        const res = await sendWebPush(sub, payload, keys, { urgency: opts.urgency ?? "normal", topic: message.tag?.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined });
        if (res.ok) {
          reached.add(sub.userId);
          await repository.touchPushSubscription(sub.endpoint, new Date()).catch(() => {});
        } else if (res.gone) await repository.deletePushSubscription(sub.endpoint);
        else log("warn", "push.send_failed", { status: res.status, host: new URL(sub.endpoint).host });
      } catch (error) {
        log("warn", "push.send_error", { host: safeHost(sub.endpoint), error: errorText(error) });
      }
    }),
  );
  return reached;
}

const safeHost = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "invalid";
  }
};

/** The services browsers use for push. A subscription anywhere else is refused, so the server never posts to an address a user typed. */
const PUSH_HOSTS = [/(^|\.)googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.example$/];

export function isPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}
