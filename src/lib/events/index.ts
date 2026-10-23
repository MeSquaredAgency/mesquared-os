import { repository } from "@/lib/data";
import type { DomainEventRecord } from "@/lib/types";

export type EventHandler = (event: DomainEventRecord) => Promise<void> | void;

const handlers = new Map<string, EventHandler[]>();

/** Subscribe a handler to an event type ("lead.qualified") or to everything ("*"). */
export function subscribe(type: string, handler: EventHandler) {
  const list = handlers.get(type) ?? [];
  list.push(handler);
  handlers.set(type, list);
}

/**
 * Appends the event to the tenant's stream and runs in-process subscribers.
 * Subscriber failures are logged, never thrown: an event is a fact, and a
 * broken listener must not undo the write that produced it.
 */
export async function emit(tenantId: string, type: string, payload: Record<string, unknown> = {}, causationId: string | null = null): Promise<DomainEventRecord> {
  const event = await repository.appendEvent(tenantId, type, payload, causationId);
  const listeners = [...(handlers.get(type) ?? []), ...(handlers.get("*") ?? [])];
  for (const handler of listeners) {
    try {
      await handler(event);
    } catch (error) {
      console.error(`[events] handler for ${type} failed:`, error instanceof Error ? error.message : error);
    }
  }
  return event;
}

/** Exposed for tests. */
export function _resetSubscribers() {
  handlers.clear();
}
