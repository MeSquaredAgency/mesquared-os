import { TasksScreen } from "@/components/collab/screens";
import { getPortalContext } from "@/lib/auth/access";

export const metadata = { title: "Tasks" };

export default async function PortalTasksPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ view?: string }> }) {
  const [{ tenant: slug }, { view }] = await Promise.all([params, searchParams]);
  const { access, user } = await getPortalContext(slug);
  return <TasksScreen access={access} user={user} base={`/app/${slug}`} view={view ?? ""} />;
}
