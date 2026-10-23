import { Badge } from "@/components/ui/badge";
import { humanize } from "@/lib/utils";

type Variant = "green" | "red" | "secondary" | "muted" | "outline";

/**
 * One mapping for every status enum in the app, so the same meaning always
 * gets the same colour: failures red, successes green, in-flight secondary,
 * finished muted, everything else outline.
 */
const STATUS_VARIANT: Record<string, Variant> = {
  // Leads
  NEW: "secondary",
  QUALIFIED: "green",
  BOOKING_SENT: "green",
  BOOKED: "green",
  NURTURING: "outline",
  WON: "green",
  LOST: "red",
  ARCHIVED: "muted",
  // Tasks
  OPEN: "outline",
  IN_PROGRESS: "secondary",
  WAITING: "secondary",
  DONE: "muted",
  CANCELLED: "muted",
  // Priority
  URGENT: "red",
  HIGH: "secondary",
  NORMAL: "outline",
  LOW: "muted",
  // Transactions
  PENDING: "secondary",
  COMPLETED: "muted",
  FAILED: "red",
  REFUNDED: "red",
  // Content & posts
  DRAFT: "outline",
  IN_REVIEW: "secondary",
  PENDING_APPROVAL: "secondary",
  APPROVED: "green",
  REJECTED: "red",
  SCHEDULED: "secondary",
  PUBLISHING: "secondary",
  PUBLISHED: "muted",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant={STATUS_VARIANT[status] ?? "outline"} className={className}>
      {humanize(status)}
    </Badge>
  );
}
