import { repository } from "@/lib/data";

/** Lead id → the newest call brief on it, for the leads a page is about to show. */
export async function latestCallBriefs(tenantId: string, leadIds: string[]): Promise<Record<string, string>> {
  if (leadIds.length === 0) return {};
  const out: Record<string, string> = {};
  // Newest first, so the first brief seen for a lead is the one to show.
  for (const note of await repository.listLeadNotes(tenantId, leadIds, { kind: "CALL_BRIEF", limit: 500 })) out[note.leadId] ??= note.body;
  return out;
}
