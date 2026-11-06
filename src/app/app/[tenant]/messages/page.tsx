import { MessagesScreen } from "@/components/collab/screens";
import { getPortalContext } from "@/lib/auth/access";

export const metadata = { title: "Messages" };

export default async function PortalMessagesPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { access, user } = await getPortalContext(slug);
  return <MessagesScreen access={access} user={user} base={`/app/${slug}`} />;
}
