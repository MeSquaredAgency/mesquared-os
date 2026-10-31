import { Badge } from "@/components/ui/badge";
import type { OnboardingStatus } from "@/lib/types";

export const ONBOARDING_STATUS_LABEL: Record<OnboardingStatus, string> = {
  INVITED: "Link sent",
  IN_PROGRESS: "Being filled in",
  SUBMITTED: "Ready to review",
  PROVISIONED: "Workspace created",
  CANCELLED: "Withdrawn",
};

const VARIANT: Record<OnboardingStatus, "outline" | "secondary" | "green" | "muted" | "default"> = {
  INVITED: "outline",
  IN_PROGRESS: "secondary",
  SUBMITTED: "default",
  PROVISIONED: "green",
  CANCELLED: "muted",
};

export function OnboardingStatusBadge({ status }: { status: OnboardingStatus }) {
  return <Badge variant={VARIANT[status]}>{ONBOARDING_STATUS_LABEL[status]}</Badge>;
}
