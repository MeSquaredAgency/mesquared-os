import { Badge } from "@/components/ui/badge";
import type { OnboardingStatus } from "@/lib/types";

export const ONBOARDING_STATUS_LABEL: Record<OnboardingStatus, string> = {
  INVITED: "Link sent",
  IN_PROGRESS: "Being filled in",
  SUBMITTED: "Ready to review",
  PROVISIONED: "Workspace created",
  CANCELLED: "Withdrawn",
};

/** Same meanings as every other status chip: in flight navy, waiting on us amber, done green, finished muted. */
const VARIANT: Record<OnboardingStatus, "outline" | "secondary" | "green" | "muted" | "amber"> = {
  INVITED: "outline",
  IN_PROGRESS: "secondary",
  SUBMITTED: "amber",
  PROVISIONED: "green",
  CANCELLED: "muted",
};

export function OnboardingStatusBadge({ status }: { status: OnboardingStatus }) {
  return <Badge variant={VARIANT[status]}>{ONBOARDING_STATUS_LABEL[status]}</Badge>;
}
