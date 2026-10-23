import type { TicketType } from "./types";

/**
 * Client-facing language. "Green" and "red" are internal words and never
 * reach a client screen; every surface pulls its labels from here.
 */
export const COPY = {
  needsYou: "Needs you",
  handledForYou: "Handled for you",
  recovered: "Recovered",
  missedOpportunities: "Missed opportunities",
  atRisk: "at risk",
  money: "Money",
  awaitingApproval: "Waiting for your approval",
  activityLog: "Activity log",
} as const;

export function ticketLabel(type: TicketType | null): string {
  return type === "GREEN" ? COPY.needsYou : type === "RED" ? COPY.handledForYou : "New";
}

export const MISSED_OPPORTUNITY_LABEL: Record<string, string> = {
  UNANSWERED_ENQUIRY: "Unanswered enquiry",
  MISSED_CALL: "Missed call",
  ABANDONED_FORM: "Abandoned form",
  NOT_BOOKED: "Never booked",
  NO_SHOW: "No-show",
  QUIET_QUOTE: "Quote gone quiet",
  UNREPLIED_DM: "Unreplied message",
  UNREPLIED_COMMENT: "Unreplied comment",
  UNANSWERED_REVIEW: "Unanswered review",
  LAPSED_CUSTOMER: "Lapsed customer",
};
