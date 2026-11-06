import { ConsoleCrumbs, consoleWorkspace } from "@/components/collab/console-crumbs";
import { MessagesScreen } from "@/components/collab/screens";

export const metadata = { title: "Messages" };

export default async function ConsoleMessagesPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { access, user } = await consoleWorkspace(slug);
  return <MessagesScreen access={access} user={user} base={`/console/${slug}`} eyebrow={<ConsoleCrumbs slug={slug} name={access.tenant.name} />} />;
}
