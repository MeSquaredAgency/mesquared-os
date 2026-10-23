import type { LeadRecord, TicketType } from "@/lib/types";

/** Name to show for a lead, falling back to whatever contact detail we have. */
export function leadDisplayName(lead: Pick<LeadRecord, "firstName" | "lastName" | "email" | "phone">): string {
  return [lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.email || lead.phone || "Unknown";
}

export function ticketVariant(type: TicketType | null): "green" | "red" | "muted" {
  if (type === "GREEN") return "green";
  if (type === "RED") return "red";
  return "muted";
}

/** Operator-facing label for which engine classified a lead. */
export function classifierLabel(qualifiedBy: string | null): string {
  if (!qualifiedBy) return "Not yet classified";
  if (qualifiedBy.startsWith("anthropic")) return "AI";
  if (qualifiedBy.startsWith("operator")) return "Operator";
  return "Rules";
}
