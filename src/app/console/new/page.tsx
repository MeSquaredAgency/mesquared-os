import Link from "next/link";
import { notFound } from "next/navigation";
import { NewWorkspaceForm } from "@/components/console/new-workspace-form";
import { PageHeader } from "@/components/shell/section";
import { getConsoleContext } from "@/lib/auth/access";
import { TEMPLATES } from "@/lib/templates";
import { REGION_PRESETS } from "@/lib/tenants/provision";

export const metadata = { title: "New workspace" };

export default async function NewWorkspacePage() {
  const { user } = await getConsoleContext();
  if (!user.isPlatformAdmin) notFound();
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={
          <>
            <Link href="/console" className="hover:text-foreground hover:underline">
              Portfolio
            </Link>
            <span aria-hidden="true">/</span>
            New workspace
          </>
        }
        title="Set up a client"
        lede="Each template seeds the pipeline, response times, posting rhythm, automations and compliance rules for that kind of business. Everything can be changed afterwards in Settings."
      />
      <NewWorkspaceForm templates={TEMPLATES.map((t) => ({
          key: t.key,
          name: t.name,
          group: t.group,
          examples: t.examples,
          summary: t.summary,
          stages: (t.pipelines.find((p) => p.isDefault) ?? t.pipelines[0]).stages.map((s) => s.name),
          postsPerWeek: Number(t.modules.find((m) => m.key === "content")?.settings?.postsPerWeek ?? 0),
          firstResponseMinutes: t.sla.firstResponseMinutes,
          licence: t.licence,
        }))} regions={REGION_PRESETS} />
    </div>
  );
}
