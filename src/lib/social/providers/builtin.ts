import { googleBusinessSocialProvider } from "./google-business";
import { registerSocialProvider } from "./index";
import { linkedInSocialProvider } from "./linkedin";
import { metaSocialProvider } from "./meta";
import { tiktokSocialProvider } from "./tiktok";
import type { SocialProvider } from "./types";
import { youtubeSocialProvider } from "./youtube";

/**
 * Registers every real platform adapter with the registry in ./index. Safe to
 * call more than once; only the first call does any work. The registry still
 * answers with the log provider when SOCIAL_MODE=log, so demo mode and CI are
 * unaffected by registering these.
 */

export const builtInSocialProviders: readonly SocialProvider[] = [
  metaSocialProvider,
  googleBusinessSocialProvider,
  linkedInSocialProvider,
  youtubeSocialProvider,
  tiktokSocialProvider,
];

let registered = false;

export function registerBuiltInProviders(): void {
  if (registered) return;
  registered = true;
  for (const provider of builtInSocialProviders) registerSocialProvider(provider);
}
