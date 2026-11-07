import { randomUUID } from "node:crypto";
import { appUrl, peopleOnSide } from "@/lib/collab/people";
import { repository } from "@/lib/data";
import { errorText, log } from "@/lib/log";
import { sendMessage, templates } from "@/lib/messaging";
import { pushToPeople } from "@/lib/push";
import type { Side, TenantSummary } from "@/lib/types";
import { decryptChatText, encryptChatText } from "./crypto";

export const CHAT_MAX_LENGTH = 4000;
/** A second message from the same side inside this window does not email the other side again (push still goes). */
export const CHAT_NOTIFY_QUIET_MS = 30 * 60_000;

export interface ChatView {
  id: string;
  authorId: string | null;
  authorName: string;
  side: Side;
  /** Null when it could not be decrypted (a damaged row, or a key this deployment no longer holds). */
  text: string | null;
  createdAt: Date;
}

/** The latest messages, oldest first, decrypted for someone allowed to read this workspace. */
export async function readChat(tenantId: string, opts: { before?: Date; limit?: number } = {}): Promise<ChatView[]> {
  const rows = await repository.listChatMessages(tenantId, { limit: 100, ...opts });
  return rows.map((m) => ({ id: m.id, authorId: m.authorId, authorName: m.authorName, side: m.side, text: decryptChatText(m.ciphertext, tenantId, m.id), createdAt: m.createdAt }));
}

export function cleanChatText(raw: string): string {
  return raw.replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
}

/**
 * Stores a message (encrypted before it leaves this function) and marks the
 * chat read for its author. Everyone on the other side gets a notification on
 * each device they turned notifications on for. People with none get an
 * email instead, unless this side already wrote in the last half hour. Both
 * say who wrote, never what.
 */
export async function postChatMessage(input: { tenant: TenantSummary; authorId: string; authorName: string; side: Side; text: string }, now = new Date()): Promise<ChatView> {
  const text = cleanChatText(input.text);
  if (!text) throw new Error("Write a message first.");
  if (text.length > CHAT_MAX_LENGTH) throw new Error(`Messages are limited to ${CHAT_MAX_LENGTH} characters.`);
  const { tenant } = input;
  const before = await repository.listChatMessages(tenant.id, { limit: 1 });
  const id = `chat_${randomUUID()}`;
  const row = await repository.addChatMessage(tenant.id, { id, authorId: input.authorId, authorName: input.authorName, side: input.side, ciphertext: encryptChatText(text, tenant.id, id) });
  await repository.markChatRead(tenant.id, input.authorId, row.createdAt);

  const last = before.at(-1);
  const mid = Boolean(last && last.side === input.side && now.getTime() - last.createdAt.getTime() < CHAT_NOTIFY_QUIET_MS);
  await notifyOtherSide(tenant, input.side, input.authorId, input.side === "ME2" ? `${input.authorName} at Me²` : input.authorName, { emailToo: !mid }).catch((error) => log("error", "chat.notify_failed", { tenantId: tenant.id, error: errorText(error) }));
  return { id, authorId: input.authorId, authorName: input.authorName, side: input.side, text, createdAt: row.createdAt };
}

async function notifyOtherSide(tenant: TenantSummary, from: Side, authorId: string, fromLabel: string, opts: { emailToo: boolean }) {
  const to = (await peopleOnSide(tenant.id, from === "ME2" ? "CLIENT" : "ME2")).filter((r) => r.userId !== authorId);
  const path = from === "ME2" ? `/app/${tenant.slug}/messages` : `/console/${tenant.slug}/messages`;
  const pushed = await pushToPeople(
    to.map((r) => r.userId),
    { title: fromLabel, body: `New message · ${tenant.name}`, url: path, tag: `chat-${tenant.slug}` },
    { urgency: "high" },
  );
  if (!opts.emailToo) return;
  for (const r of to.filter((r) => !pushed.has(r.userId))) {
    const mail = templates.chatNotificationEmail({ tenant, firstName: r.name?.trim().split(/\s+/)[0] ?? null, from: fromLabel, chatUrl: appUrl(path) });
    const sent = await sendMessage({ tenant, contactId: null, channel: "EMAIL", to: r.email, subject: mail.subject, body: mail.body, transactional: true });
    if (!sent.ok && !sent.simulated) log("warn", "chat.notify_send_failed", { tenantId: tenant.id, error: sent.error });
  }
}
