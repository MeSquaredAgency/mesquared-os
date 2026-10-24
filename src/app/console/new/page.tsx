import { notFound } from "next/navigation";
import { NewWorkspaceForm } from "@/components/console/new-workspace-form";
import { getConsoleContext } from "@/lib/auth/access";
import { TEMPLATES } from "@/lib/templates";
import { REGION_PRESETS } from "@/lib/tenants/provision";

export const metadata = { title: "New workspace" };

export default async function NewWorkspacePage() {
  const { user } = await getConsoleContext();
  if (!user.isPlatformAdmin) notFound();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">New workspace</h1>
        <p className="text-sm text-muted-foreground">A client is set up by applying a template. The real-estate template carries the licence line and the listing flows; health and fitness carries memberships and classes; generic covers the rest.</p>
      </div>
      <NewWorkspaceForm templates={TEMPLATES.map((t) => ({ key: t.key, name: t.name, industry: t.industry }))} regions={REGION_PRESETS} />
    </div>
  );
}
