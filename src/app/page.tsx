import { redirect } from "next/navigation";
import { homePathFor } from "@/lib/auth/access";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireUser();
  redirect(await homePathFor(user));
}
