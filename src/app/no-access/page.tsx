import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "No workspace yet" };

export default async function NoAccessPage() {
  const user = await requireUser();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-lg font-semibold">No workspace yet</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{user.email} is signed in but hasn’t been added to a workspace. Ask your MeSquared contact to add you.</p>
      <form action={signOut}>
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </main>
  );
}
