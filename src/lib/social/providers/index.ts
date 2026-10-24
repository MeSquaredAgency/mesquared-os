import type { SocialPlatform } from "@/lib/types";
import { logSocialProvider } from "./log";
import type { SocialProvider } from "./types";

export * from "./types";
export { logSocialProvider } from "./log";

/**
 * Registry of platform adapters. Real adapters register themselves here by
 * importing their module; anything unregistered, or everything when
 * SOCIAL_MODE=log, falls back to the log provider so the pipeline still runs
 * and every run says "simulated" honestly.
 */
const registry = new Map<SocialPlatform, SocialProvider>();

export function registerSocialProvider(provider: SocialProvider) {
  for (const p of provider.platforms) registry.set(p, provider);
}

export function socialProviderFor(platform: SocialPlatform): SocialProvider {
  if (process.env.SOCIAL_MODE === "log") return logSocialProvider;
  return registry.get(platform) ?? logSocialProvider;
}

/** True when a real adapter (not the log fallback) will handle the platform. */
export function hasRealProvider(platform: SocialPlatform): boolean {
  return process.env.SOCIAL_MODE !== "log" && registry.has(platform);
}
