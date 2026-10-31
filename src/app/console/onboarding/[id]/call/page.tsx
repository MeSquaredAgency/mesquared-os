import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
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
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={
          <>
            <Link href="/console/onboarding" className="hover:text-foreground hover:underline">
              Onboarding
            </Link>
            <span aria-hidden="true">/</span>
            <Link href={`/console/onboarding/${record.id}`} className="hover:text-foreground hover:underline">
              {record.label}
            </Link>
            <span aria-hidden="true">/</span>
            Intake call
          </>
        }
        title={`Call sheet: ${record.label}`}
        lede={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <OnboardingStatusBadge status={record.status} />
            <span>{closed ? "This questionnaire is closed. Change the workspace in its Settings instead." : "Fill this in during or straight after the call. The client's answers are already in; everything you add feeds the same workspace draft."}</span>
          </span>
        }
        actions={
          <Button asChild variant="outline">
            <Link href={`/console/onboarding/${record.id}`}>
              <ArrowLeft /> Back to review
            </Link>
          </Button>
        }
      />
      <CallSheet id={record.id} initial={sanitizeAnswers(record.answers)} readOnly={closed} />
    </div>
  );
}
