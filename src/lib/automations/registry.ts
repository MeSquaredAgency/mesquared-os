/**
 * Reusable automation types a tenant switches on. Each has a stable key
 * stored on TenantAutomation rows, the events that trigger it, and whether
 * it is on by default. Handlers arrive with Phases 1–2; the registry exists
 * now so configuration and the activity log are stable from day one.
 */
export interface AutomationDefinition {
  key: string;
  name: string;
  description: string;
  triggers: string[];
  defaultEnabled: boolean;
}

export const AUTOMATIONS: AutomationDefinition[] = [
  { key: "enquiry_auto_reply", name: "Enquiry auto-reply", description: "Acknowledges every new enquiry with details and a booking link.", triggers: ["lead.qualified"], defaultEnabled: true },
  { key: "booking_lifecycle", name: "Booking confirmation, reminder and follow-up", description: "Confirms, reminds before, and follows up after every booking.", triggers: ["booking.created", "booking.completed"], defaultEnabled: true },
  { key: "chase_information", name: "Chase documents or information", description: "Politely chases anything the business is waiting on.", triggers: ["request.opened"], defaultEnabled: false },
  { key: "review_request", name: "Review requests", description: "Asks happy customers for a review at the right moment.", triggers: ["booking.completed", "payment.received"], defaultEnabled: true },
  { key: "payment_reminders", name: "Invoice and overdue-payment reminders", description: "Reminds before due dates and chases overdue invoices.", triggers: ["invoice.due", "invoice.overdue"], defaultEnabled: false },
  { key: "inbox_triage", name: "DM and comment triage", description: "Answers routine messages and comments, escalates the rest.", triggers: ["inbox.received"], defaultEnabled: false },
  { key: "reactivation", name: "Reactivate lapsed customers", description: "Reaches out to past customers who have gone quiet.", triggers: ["contact.lapsed"], defaultEnabled: false },
  { key: "sla_watch", name: "Response and booking watch", description: "Turns leads that miss the response or booking window into missed opportunities for an operator.", triggers: ["schedule"], defaultEnabled: true },
  { key: "content_engine", name: "Content engine", description: "Drafts one post per channel from new material and good reviews, checks brand and compliance rules, and flags gaps in the calendar.", triggers: ["content.source.created", "review.received", "schedule"], defaultEnabled: true },
  { key: "social_publish", name: "Social publishing", description: "Publishes approved posts at their scheduled time and reports what went out.", triggers: ["schedule"], defaultEnabled: true },
  { key: "social_sync", name: "Social inbox and analytics sync", description: "Pulls comments, messages, reviews and channel numbers from connected platforms.", triggers: ["schedule"], defaultEnabled: true },
  { key: "messaging", name: "Held messages", description: "Sends messages held during quiet hours when the morning comes.", triggers: ["schedule"], defaultEnabled: true },
];

export const AUTOMATION_BY_KEY: Record<string, AutomationDefinition> = Object.fromEntries(AUTOMATIONS.map((a) => [a.key, a]));
