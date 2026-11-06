import { TaskScreen } from "@/components/collab/screens";
import { getPortalContext } from "@/lib/auth/access";

export const metadata = { title: "Task" };

export default async function PortalTaskPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  const { access, user } = await getPortalContext(slug);
  return <TaskScreen access={access} user={user} base={`/app/${slug}`} taskId={id} />;
}
