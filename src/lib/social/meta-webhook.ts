import { repository } from "@/lib/data";
import { parseMetaInboxEvents, type MetaInboxEvent, type MetaWebhookObject } from "@/lib/intake/channels/meta";
import type { ChannelRecord, TenantSummary } from "@/lib/types";
import { ingestInboxItems } from "./inbox";

/**
 * Routing Meta inbox webhooks to the tenant and channel they belong to.
 *
 * A `page` webhook's entry id is the Facebook page id, which is what the
 * tenant's META integration row is keyed by. An `instagram` webhook's entry
 * id is the Instagram business account id, which the integration row does not
 * carry; it lives on the Instagram channel (`externalAccountId` and
 * `settings.igUserId`). Each kind is looked up where its id lives first, with
 * the other lookup as a fallback, so an integration keyed by the Instagram id
 * or an Instagram channel whose page was never connected still resolves.
 * Unknown ids are dropped: Meta must always get a 200.
 *
 * Kept free of `next/*` so the routing can be tested with recorded payloads.
 */

export interface MetaInboxTarget {
  tenant: TenantSummary;
  channel: ChannelRecord;
}

/** The tenant and channel an inbox event with this entry id belongs to, or null when no tenant owns it. */
export async function resolveMetaInboxTarget(object: MetaWebhookObject, accountId: string): Promise<MetaInboxTarget | null> {
  const byIntegration = () => repository.findTenantByIntegrationAccount("META", accountId);
  const byChannel = () => repository.findTenantByChannelAccount("INSTAGRAM", accountId);
  const tenant = object === "instagram" ? ((await byChannel()) ?? (await byIntegration())) : ((await byIntegration()) ?? (await byChannel()));
  if (!tenant) return null;
  const channels = await repository.listChannels(tenant.id, { activeOnly: true });
  const fallbackPlatform = object === "instagram" ? "INSTAGRAM" : "FACEBOOK";
  const channel = channels.find((c) => c.externalAccountId === accountId || c.settings.igUserId === accountId) ?? channels.find((c) => c.platform === fallbackPlatform) ?? null;
  return channel ? { tenant, channel } : null;
}

/** Parses a Meta webhook body and files its comments and messages in the owning tenants' inboxes. Returns how many were new and which entry ids no tenant owns. */
export async function ingestMetaWebhookInbox(body: unknown): Promise<{ inboxNew: number; unresolved: string[] }> {
  const groups = new Map<string, { object: MetaWebhookObject; accountId: string; items: MetaInboxEvent[] }>();
  for (const item of parseMetaInboxEvents(body)) {
    const key = `${item.object}:${item.pageId}`;
    const group = groups.get(key) ?? { object: item.object, accountId: item.pageId, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  let inboxNew = 0;
  const unresolved: string[] = [];
  for (const { object, accountId, items } of groups.values()) {
    const target = await resolveMetaInboxTarget(object, accountId);
    if (!target) {
      unresolved.push(accountId);
      continue;
    }
    try {
      inboxNew += await ingestInboxItems(
        target.tenant,
        target.channel,
        items.map((i) => ({ externalId: i.externalId, threadId: i.threadId, kind: i.kind, authorName: i.authorName, authorId: i.authorId, text: i.text, receivedAt: i.receivedAt, postExternalId: i.postExternalId, meta: { pageId: accountId, webhookObject: object } })),
      );
    } catch (error) {
      console.error(`[webhooks/meta] inbox for ${object} ${accountId} failed: ${error instanceof Error ? error.message : error}`);
    }
  }
  return { inboxNew, unresolved };
}
