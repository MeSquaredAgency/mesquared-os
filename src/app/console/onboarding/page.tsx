import Link from "next/link";
import { notFound } from "next/navigation";
import { NewOnboardingLink } from "@/components/console/onboarding-new";
import { OnboardingStatusBadge } from "@/components/console/onboarding-status";
import { Empty, PageHeader, Section } from "@/components/shell/section";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { getConsoleContext } from "@/lib/auth/access";
import { repository } from "@/lib/data";
import { sanitizeAnswers, stepProgress } from "@/lib/onboarding/form";
import { timeAgo } from "@/lib/utils";

export const metadata = { title: "Onboarding" };

export default async function OnboardingListPage() {
  const { user } = await getConsoleContext();
  if (!user.isPlatformAdmin) notFound();
  const rows = await repository.listOnboardings({ limit: 200 });
  const ready = rows.filter((r) => r.status === "SUBMITTED").length;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Onboarding" title={ready ? `${ready} questionnaire${ready === 1 ? "" : "s"} ready to review` : "Client questionnaires"} lede="Send a new client a private link to the onboarding form. Their answers save as they go and land here, drafted into a workspace you can create in one step." />

      <Section id="new-onboarding" title="New questionnaire" lede="The link is shown once, like an API key. If it gets lost, open the questionnaire and make a new one.">
        <NewOnboardingLink />
      </Section>

      <Section id="onboarding-list" title="Every questionnaire" lede="Newest activity first.">
        {rows.length === 0 ? (
          <Empty>No questionnaires yet. Create a link above and send it to your client.</Empty>
        ) : (
          <div className="surface overflow-hidden">
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Client</TH>
                  <TH>Status</TH>
                  <TH numeric>Answered</TH>
                  <TH>Last activity</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => {
                  const progress = Object.values(stepProgress(sanitizeAnswers(r.answers)));
                  const answered = progress.reduce((n, p) => n + p.answered, 0);
                  const total = progress.reduce((n, p) => n + p.total, 0);
                  return (
                    <TR key={r.id}>
                      <TD>
                        <Link href={`/console/onboarding/${r.id}`} className="font-medium whitespace-nowrap hover:underline">
                          {r.label}
                        </Link>
                        {r.contactEmail && <p className="text-xs text-muted-foreground">{r.contactEmail}</p>}
                      </TD>
                      <TD>
                        <OnboardingStatusBadge status={r.status} />
                      </TD>
                      <TD numeric>
                        {answered} of {total}
                      </TD>
                      <TD className="whitespace-nowrap text-muted-foreground">{timeAgo(r.updatedAt)}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </div>
        )}
      </Section>
    </div>
  );
}
