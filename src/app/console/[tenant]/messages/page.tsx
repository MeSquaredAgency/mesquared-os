import { ConsoleCrumbs, consoleWorkspace } from "@/components/collab/console-crumbs";
import { MessagesScreen } from "@/components/collab/screens";

export const metadata = { title: "Messages" };

export default async function ConsoleMessagesPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ show?: string; before?: string }> }) {
  const [{ tenant: slug }, { show, before }] = await Promise.all([params, searchParams]);
  const { access, user } = await consoleWorkspace(slug);
  return <MessagesScreen access={access} user={user} base={`/console/${slug}`} show={show} before={before} eyebrow={<ConsoleCrumbs slug={slug} name={access.tenant.name} />} />;
}
