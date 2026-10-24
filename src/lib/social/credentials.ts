import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { repository } from "@/lib/data";
import type { ChannelRecord, IntegrationProvider, SocialPlatform } from "@/lib/types";
import type { ChannelCredentials } from "./providers/types";

/**
 * Channel credentials live encrypted on the tenant's Integration row for the
 * platform family (one META integration covers Facebook and Instagram). They
 * are decrypted per call, bound to the integration id, and never logged.
 */
export const PLATFORM_INTEGRATION: Record<SocialPlatform, IntegrationProvider> = {
  FACEBOOK: "META",
  INSTAGRAM: "META",
  TIKTOK: "TIKTOK",
  YOUTUBE: "YOUTUBE",
  LINKEDIN: "LINKEDIN",
  GOOGLE_BUSINESS: "GOOGLE_BUSINESS",
};

export async function loadChannelCredentials(tenantId: string, channel: Pick<ChannelRecord, "platform">): Promise<{ integrationId: string; creds: ChannelCredentials } | null> {
  const integration = await repository.findIntegration(tenantId, PLATFORM_INTEGRATION[channel.platform]);
  if (!integration?.credentialsEnc) return null;
  try {
    const plain = decryptSecret(integration.credentialsEnc, integration.id);
    const parsed = plain.startsWith("{") ? (JSON.parse(plain) as ChannelCredentials) : { accessToken: plain };
    return parsed.accessToken ? { integrationId: integration.id, creds: parsed } : null;
  } catch (error) {
    console.error(`[social] could not read credentials for ${channel.platform}: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/** Stores (or replaces) the credentials for a platform family and marks the integration connected. */
export async function saveChannelCredentials(tenantId: string, platform: SocialPlatform, creds: ChannelCredentials, opts: { externalAccountId: string; label?: string | null }) {
  const provider = PLATFORM_INTEGRATION[platform];
  const existing = await repository.findIntegration(tenantId, provider);
  // Encrypt with the row id as AAD, so the row has to exist first.
  const row = existing ?? (await repository.upsertIntegration(tenantId, { provider, externalAccountId: opts.externalAccountId, label: opts.label ?? null, status: "PENDING" }));
  await repository.upsertIntegration(tenantId, { provider, externalAccountId: opts.externalAccountId, label: opts.label ?? null, status: "CONNECTED", credentialsEnc: encryptSecret(JSON.stringify(creds), row.id), lastError: null });
}

/** After a refresh, persist the new token under the same row. */
export async function rotateChannelCredentials(tenantId: string, integrationId: string, platform: SocialPlatform, creds: ChannelCredentials) {
  const provider = PLATFORM_INTEGRATION[platform];
  const existing = await repository.findIntegration(tenantId, provider);
  if (!existing || existing.id !== integrationId) return;
  await repository.upsertIntegration(tenantId, { provider, externalAccountId: existing.externalAccountId ?? "", status: "CONNECTED", credentialsEnc: encryptSecret(JSON.stringify(creds), integrationId), lastError: null });
}

/** Marks the platform's integration as needing attention with a short reason an operator can read. */
export async function flagIntegration(tenantId: string, platform: SocialPlatform, error: string) {
  const provider = PLATFORM_INTEGRATION[platform];
  const existing = await repository.findIntegration(tenantId, provider);
  if (!existing) return;
  await repository.upsertIntegration(tenantId, { provider, externalAccountId: existing.externalAccountId ?? "", status: "NEEDS_ATTENTION", lastError: error.slice(0, 300) });
}
