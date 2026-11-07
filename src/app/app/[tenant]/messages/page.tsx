import { MessagesScreen } from "@/components/collab/screens";
import { getPortalContext } from "@/lib/auth/access";

export const metadata = { title: "Messages" };

export default async function PortalMessagesPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ show?: string; before?: string }> }) {
  const [{ tenant: slug }, { show, before }] = await Promise.all([params, searchParams]);
  const { access, user } = await getPortalContext(slug);
  return <MessagesScreen access={access} user={user} base={`/app/${slug}`} show={show} before={before} />;
}
