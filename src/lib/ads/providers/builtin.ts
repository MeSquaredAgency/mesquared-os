import { googleAdsProvider } from "./google";
import { registerAdsProvider } from "./index";
import { metaAdsProvider } from "./meta";
import type { AdsProvider } from "./types";

/**
 * Registers every real ad platform adapter with the registry in ./index. Safe
 * to call more than once; only the first call does any work. The registry
 * still answers with the log provider when ADS_MODE=log, so demo mode and CI
 * are unaffected by registering these.
 */

export const builtInAdsProviders: readonly AdsProvider[] = [metaAdsProvider, googleAdsProvider];

let registered = false;

export function registerBuiltInAdsProviders(): void {
  if (registered) return;
  registered = true;
  for (const provider of builtInAdsProviders) registerAdsProvider(provider);
}
