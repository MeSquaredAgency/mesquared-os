import { Badge } from "@/components/ui/badge";
import { humanize } from "@/lib/utils";

type Variant = "green" | "red" | "amber" | "secondary" | "muted" | "outline";

/**
 * One mapping for every status enum in the app, so the same meaning always
 * gets the same colour: failures red, successes green, waiting amber,
 * in-flight navy, finished muted, everything else a quiet outline.
 */
const STATUS_VARIANT: Record<string, Variant> = {
  // Leads
  NEW: "secondary",
  QUALIFIED: "green",
  BOOKING_SENT: "secondary",
  BOOKED: "green",
  NURTURING: "outline",
  WON: "green",
  LOST: "red",
  ARCHIVED: "muted",
  // Tasks
  OPEN: "outline",
  IN_PROGRESS: "secondary",
  WAITING: "amber",
  DONE: "muted",
  CANCELLED: "muted",
  // Priority
  URGENT: "red",
  HIGH: "amber",
  NORMAL: "outline",
  LOW: "muted",
  // Transactions and invoices
  PENDING: "amber",
  COMPLETED: "muted",
  FAILED: "red",
  REFUNDED: "red",
  SENT: "secondary",
  OVERDUE: "red",
  PAID: "green",
  VOID: "muted",
  // Bookings
  SCHEDULED: "secondary",
  NO_SHOW: "red",
  // Content & posts
  DRAFT: "outline",
  IN_REVIEW: "amber",
  PENDING_APPROVAL: "amber",
  APPROVED: "green",
  REJECTED: "red",
  PUBLISHING: "secondary",
  PUBLISHED: "muted",
  // Integrations
  CONNECTED: "green",
  NEEDS_ATTENTION: "red",
  DISCONNECTED: "red",
};

export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  return (
    <Badge variant={STATUS_VARIANT[status] ?? "outline"} className={className}>
      {label ?? humanize(status)}
    </Badge>
  );
}
