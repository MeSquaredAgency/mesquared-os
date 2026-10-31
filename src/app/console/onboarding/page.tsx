import Link from "next/link";
import { notFound } from "next/navigation";
import { NewOnboardingLink } from "@/components/console/onboarding-new";
import { OnboardingStatusBadge } from "@/components/console/onboarding-status";
import { Empty, PageHeader, Panel, Section } from "@/components/shell/section";
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
    <div className="flex flex-col gap-10">
      <PageHeader kicker="Onboarding" title={ready ? `${ready} questionnaire${ready === 1 ? "" : "s"} ready to review` : "Client questionnaires"} lede="Send a new client a private link to the onboarding form. Their answers save as they go and land here, drafted into a workspace you can create in one step." />

      <Section id="new-onboarding" title="New questionnaire" lede="The link is shown once, like an API key. If it gets lost, open the questionnaire and make a new one.">
        <NewOnboardingLink />
      </Section>

      <Section id="onboarding-list" title="Every questionnaire" lede="Newest activity first.">
        {rows.length === 0 ? (
          <Empty>No questionnaires yet. Create a link above and send it to your client.</Empty>
        ) : (
          <Panel className="overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="px-5 py-3 font-medium">Client</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Answered</th>
                  <th className="px-5 py-3 font-medium">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const progress = Object.values(stepProgress(sanitizeAnswers(r.answers)));
                  const answered = progress.reduce((n, p) => n + p.answered, 0);
                  const total = progress.reduce((n, p) => n + p.total, 0);
                  return (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="px-5 py-3">
                        <Link href={`/console/onboarding/${r.id}`} className="font-medium underline-offset-4 hover:underline">
                          {r.label}
                        </Link>
                        {r.contactEmail && <p className="text-muted-foreground">{r.contactEmail}</p>}
                      </td>
                      <td className="px-5 py-3">
                        <OnboardingStatusBadge status={r.status} />
                      </td>
                      <td className="px-5 py-3 tabular-nums">
                        {answered} of {total}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">{timeAgo(r.updatedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        )}
      </Section>
    </div>
  );
}
