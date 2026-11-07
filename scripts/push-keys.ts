/**
 * Prints a fresh VAPID key pair for browser and phone notifications.
 *
 *   npm run push:keys
 *
 * Set both as secrets on the worker (wrangler secret put VAPID_PUBLIC_KEY, then
 * VAPID_PRIVATE_KEY). Keep them for good: changing them means every device has
 * to turn notifications on again.
 */
import { generateVapidKeys } from "@/lib/push/webpush";

const keys = await generateVapidKeys();
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
