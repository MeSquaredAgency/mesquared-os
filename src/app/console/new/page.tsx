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
        lede="A client is set up by applying a template. Real estate carries the licence line and the listing flows; health and fitness carries memberships and classes; generic covers the rest."
      />
      <NewWorkspaceForm templates={TEMPLATES.map((t) => ({ key: t.key, name: t.name, industry: t.industry }))} regions={REGION_PRESETS} />
    </div>
  );
}
