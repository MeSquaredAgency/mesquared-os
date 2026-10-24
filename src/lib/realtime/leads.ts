import type { LeadRecord, LeadSource, LeadStatus, TicketType } from "@/lib/types";

/**
 * Row shape of the live lead list. It is what the Realtime SQL in
 * `server.ts` selects and what the server render passes as initial data, so
 * both sides of hydration agree. `createdAt` may arrive as a string from the
 * live stream; format it with `formatDateTime`, which accepts both.
 */
export interface LiveLeadRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  message: string | null;
  source: LeadSource;
  status: LeadStatus;
  ticketType: TicketType | null;
  intentScore: number | null;
  qualificationReason: string | null;
  qualifiedBy: string | null;
  stageId: string | null;
  createdAt: Date | string;
}

export const LIVE_LEADS_LIMIT = 50;

export function toLiveLeadRow(l: LeadRecord): LiveLeadRow {
  return {
    id: l.id,
    firstName: l.firstName,
    lastName: l.lastName,
    email: l.email,
    phone: l.phone,
    company: l.company,
    message: l.message,
    source: l.source,
    status: l.status,
    ticketType: l.ticketType,
    intentScore: l.intentScore,
    qualificationReason: l.qualificationReason,
    qualifiedBy: l.qualifiedBy,
    stageId: l.stageId,
    createdAt: l.createdAt,
  };
}
