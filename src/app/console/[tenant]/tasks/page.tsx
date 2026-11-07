import { ConsoleCrumbs, consoleWorkspace } from "@/components/collab/console-crumbs";
import { TasksScreen } from "@/components/collab/screens";

export const metadata = { title: "Tasks" };

export default async function ConsoleTasksPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ view?: string }> }) {
  const [{ tenant: slug }, { view }] = await Promise.all([params, searchParams]);
  const { access, user } = await consoleWorkspace(slug);
  return <TasksScreen access={access} user={user} base={`/console/${slug}`} view={view ?? ""} eyebrow={<ConsoleCrumbs slug={slug} name={access.tenant.name} />} />;
}
