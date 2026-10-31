import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nothing to show yet" };

export default async function NoAccessPage() {
  const user = await requireUser();
  return (
    <main data-theme="paper" className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-center text-foreground">
      <p className="eyebrow">Signed in</p>
      <h1 className="page-title">Nothing to show yet</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{user.email} is signed in but hasn’t been added to a business yet. Ask your Me² contact to add you.</p>
      <form action={signOut} className="mt-2">
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </main>
  );
}
