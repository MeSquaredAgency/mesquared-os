import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, Phone } from "lucide-react";
import { OnboardingActions } from "@/components/console/onboarding-actions";
import { OnboardingStatusBadge } from "@/components/console/onboarding-status";
import { PageHeader, Section } from "@/components/shell/section";
import { Button } from "@/components/ui/button";
import { getConsoleContext } from "@/lib/auth/access";
import { repository } from "@/lib/data";
import { askedOnCall, CALL_SECTIONS, describeAnswer, fieldVisible, sanitizeAnswers } from "@/lib/onboarding/form";
import { draftFromOnboarding } from "@/lib/onboarding/service";
import { TEMPLATE_BY_KEY } from "@/lib/templates";
import { timeAgo } from "@/lib/utils";

export const metadata = { title: "Onboarding questionnaire" };

export default async function OnboardingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await getConsoleContext();
  if (!user.isPlatformAdmin) notFound();
  const { id } = await params;
  const record = await repository.findOnboardingById(id);
  if (!record) notFound();
  const answers = sanitizeAnswers(record.answers);
  const asked = askedOnCall(answers);
  const draft = draftFromOnboarding(record);
  const d = draft.definition;
  const template = TEMPLATE_BY_KEY[d.templateKey];
  const tenant = record.tenantId ? await repository.findTenantById(record.tenantId) : null;
  const when = record.submittedAt ? `Sent ${timeAgo(record.submittedAt)}` : record.startedAt ? `Started ${timeAgo(record.startedAt)}, last saved ${timeAgo(record.updatedAt)}` : `Link created ${timeAgo(record.createdAt)}, not opened yet`;
  const open = record.status !== "PROVISIONED" && record.status !== "CANCELLED";

  const summary: [string, string][] = [
    ["Template", template?.name ?? d.templateKey],
    ["Workspace address", d.slug ?? "(none)"],
    ["Region", `${d.region}, ${d.timezone}, ${d.currency}`],
    ["Sender", [d.fromName, d.replyTo].filter(Boolean).join(", ") || "From the template"],
    ["People", d.people?.map((p) => `${p.name} (${template?.roles.find((r) => r.key === p.role)?.name ?? p.role})`).join(", ") || "None yet"],
    ["First reply", d.sla?.firstResponseMinutes ? `${d.sla.firstResponseMinutes} minutes` : "Template default"],
    ["Booked within", d.sla?.bookingWindowHours ? `${d.sla.bookingWindowHours} hours` : "Template default"],
    ["Quiet hours", d.sla?.quietHours ? `${d.sla.quietHours.start}:00 to ${d.sla.quietHours.end}:00` : "Region default"],
    ["Compliance line", d.requiredFooter ?? "None"],
    ["Posting", d.content ? `${d.content.postsPerWeek ?? "template"} a week${d.content.slots?.length ? `, ${d.content.slots.length} slots` : ""}` : "Template default"],
  ];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={
          <>
            <Link href="/console/onboarding" className="hover:text-foreground hover:underline">
              Onboarding
            </Link>
            <span aria-hidden="true">/</span>
            Questionnaire
          </>
        }
        title={record.label}
        lede={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <OnboardingStatusBadge status={record.status} />
            <span>
              {when}.{record.contactEmail ? ` Contact: ${record.contactEmail}.` : ""}
            </span>
          </span>
        }
        actions={
          <>
            {open && (
              <Button asChild variant={tenant ? "outline" : "default"}>
                <Link href={`/console/onboarding/${record.id}/call`}>
                  <Phone /> Open the call sheet
                </Link>
              </Button>
            )}
            {tenant && (
              <Button asChild>
                <Link href={`/console/${tenant.slug}/settings`}>
                  Open the workspace <ArrowUpRight />
                </Link>
              </Button>
            )}
          </>
        }
      />

      {open && (
        <Section id="onboarding-actions" title={record.status === "SUBMITTED" ? "Create the workspace" : "Waiting for the client"} lede={record.status === "SUBMITTED" ? "Check the review list below first. Everything here can be changed in the workspace's Settings afterwards." : "The client hasn't sent it yet. You can see their answers so far below."}>
          <OnboardingActions id={record.id} label={record.label} contactEmail={record.contactEmail} status={record.status} draftSlug={d.slug ?? ""} blockers={draft.blockers} />
        </Section>
      )}

      <div className="grid gap-8 xl:grid-cols-2 xl:gap-6">
        <Section id="onboarding-review" title="To check before and after you create it" lede="Answers that could not be read, and the steps the questionnaire cannot do for you.">
          <div className="surface p-5">
            {draft.review.length ? (
              <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
                {draft.review.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing to check.</p>
            )}
          </div>
        </Section>

        <Section id="onboarding-draft" title="What will be set up" lede="Drafted from the answers. Anything not listed keeps the template's value.">
          <div className="surface p-5">
            <dl className="grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-[160px_1fr]">
              {summary.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="min-w-0 break-words">{v}</dd>
                </div>
              ))}
            </dl>
            {draft.handOver.length > 0 && (
              <div className="mt-5 flex flex-col gap-2 border-t pt-5 text-sm">
                <p className="font-medium">Tasks they would hand over (for the Operational Blueprint)</p>
                <ul className="flex list-disc flex-col gap-1 pl-5">
                  {draft.handOver.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            )}
            <details className="mt-5 border-t pt-5 text-sm">
              <summary className="cursor-pointer font-medium">Workspace file (JSON)</summary>
              <p className="mt-2 text-muted-foreground">The same definition `npm run tenant:provision` takes, if you would rather provision from a file. It holds the client’s contact details: keep it under tenants/.</p>
              <pre className="mt-3 max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(d, null, 2)}</pre>
            </details>
          </div>
        </Section>
      </div>

      <Section id="onboarding-answers" title="Their answers" lede={asked.length ? `Everything so far, from their form and the call sheet. They asked to cover ${asked.length} question${asked.length === 1 ? "" : "s"} on the call: ${asked.map((f) => (f.callLabel ?? f.label).toLowerCase()).join(", ")}.` : "Everything so far, from their form and the call sheet."}>
        <div className="surface divide-y px-5">
          {CALL_SECTIONS.map((step) => {
            const rows = step.fields.filter((f) => fieldVisible(f, answers)).map((f) => [f.callLabel ?? f.label, describeAnswer(f, answers[f.key])] as const).filter(([, v]) => v);
            return (
              <section key={step.id} aria-labelledby={`answers-${step.id}`} className="py-5">
                <h3 id={`answers-${step.id}`} className="mb-3 text-sm font-semibold">
                  {step.title}
                </h3>
                {rows.length ? (
                  <dl className="grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-[minmax(0,260px)_1fr]">
                    {rows.map(([label, value]) => (
                      <div key={label} className="contents">
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="min-w-0 whitespace-pre-line">{value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">Nothing yet.</p>
                )}
              </section>
            );
          })}
        </div>
      </Section>
    </div>
  );
}
