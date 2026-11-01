import { repository } from "@/lib/data";
import type { DomainEventRecord } from "@/lib/types";

export type EventHandler = (event: DomainEventRecord) => Promise<void> | void;

const handlers = new Map<string, EventHandler[]>();

/** How often a broken subscriber may put the same complaint in the operator queue. */
const FAILURE_NOTICE_WINDOW_MS = 60 * 60_000;

/** Subscribe a handler to an event type ("lead.qualified") or to everything ("*"). */
export function subscribe(type: string, handler: EventHandler) {
  const list = handlers.get(type) ?? [];
  list.push(handler);
  handlers.set(type, list);
}

/**
 * Appends the event to the tenant's stream and runs in-process subscribers.
 * Subscriber failures are logged, never thrown: an event is a fact, and a
 * broken listener must not undo the write that produced it. They are not
 * silent either: the first failure of its kind each hour becomes an
 * exception, because a listener that fails is usually an acknowledgement or
 * an alert that did not go out.
 */
export async function emit(tenantId: string, type: string, payload: Record<string, unknown> = {}, causationId: string | null = null): Promise<DomainEventRecord> {
  const event = await repository.appendEvent(tenantId, type, payload, causationId);
  const listeners = [...(handlers.get(type) ?? []), ...(handlers.get("*") ?? [])];
  for (const [index, handler] of listeners.entries()) {
    try {
      await handler(event);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[events] handler for ${type} failed:`, message);
      await noteFailure(tenantId, type, index, message, payload);
    }
  }
  return event;
}

async function noteFailure(tenantId: string, type: string, index: number, message: string, payload: Record<string, unknown>) {
  try {
    const { count } = await repository.rateLimitHit(`event-failure:${tenantId}:${type}:${index}`, FAILURE_NOTICE_WINDOW_MS);
    if (count > 1) return;
    const leadId = typeof payload.leadId === "string" ? payload.leadId : null;
    const contactId = typeof payload.contactId === "string" ? payload.contactId : null;
    await repository.createException(tenantId, {
      reason: `A step that runs on "${type.replace(/[._]/g, " ")}" failed: ${message.slice(0, 200)}`,
      suggestedAction: "Check what should have happened for this person (a reply, an alert, a booking link) and do it by hand; the server log has the detail.",
      confidence: 0.9,
      leadId,
      contactId,
    });
  } catch (error) {
    console.error(`[events] could not record the failure of a ${type} handler:`, error instanceof Error ? error.message : error);
  }
}

/** Exposed for tests. */
export function _resetSubscribers() {
  handlers.clear();
}
