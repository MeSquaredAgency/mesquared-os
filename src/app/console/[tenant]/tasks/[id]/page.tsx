import { ConsoleCrumbs, consoleWorkspace } from "@/components/collab/console-crumbs";
import { TaskScreen } from "@/components/collab/screens";

export const metadata = { title: "Task" };

export default async function ConsoleTaskPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  const { access, user } = await consoleWorkspace(slug);
  return <TaskScreen access={access} user={user} base={`/console/${slug}`} taskId={id} eyebrow={<ConsoleCrumbs slug={slug} name={access.tenant.name} section={{ href: `/console/${slug}/tasks`, label: "Tasks" }} />} />;
}
