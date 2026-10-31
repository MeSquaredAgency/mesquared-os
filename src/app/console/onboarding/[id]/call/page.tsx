import Link from "next/link";
import { notFound } from "next/navigation";
import { CallSheet } from "@/components/console/onboarding-call-sheet";
import { OnboardingStatusBadge } from "@/components/console/onboarding-status";
import { PageHeader } from "@/components/shell/section";
import { Button } from "@/components/ui/button";
import { getConsoleContext } from "@/lib/auth/access";
import { repository } from "@/lib/data";
import { sanitizeAnswers } from "@/lib/onboarding/form";

export const metadata = { title: "Intake call sheet" };

export default async function CallSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await getConsoleContext();
  if (!user.isPlatformAdmin) notFound();
  const { id } = await params;
  const record = await repository.findOnboardingById(id);
  if (!record) notFound();
  const closed = record.status === "PROVISIONED" || record.status === "CANCELLED";

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker="Intake call"
        title={record.label}
        lede={closed ? "This questionnaire is closed. Change the workspace in its Settings instead." : "Fill this in during or straight after the call. The client's answers are already in; everything you add feeds the same workspace draft."}
        actions={
          <div className="flex items-center gap-3">
            <OnboardingStatusBadge status={record.status} />
            <Button asChild size="sm" variant="outline">
              <Link href={`/console/onboarding/${record.id}`}>Back to review</Link>
            </Button>
          </div>
        }
      />
      <CallSheet id={record.id} initial={sanitizeAnswers(record.answers)} readOnly={closed} />
    </div>
  );
}
