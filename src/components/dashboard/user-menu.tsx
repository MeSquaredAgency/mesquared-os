import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";
import type { UserRecord } from "@/lib/types";

export function UserMenu({ user, compact = false }: { user: UserRecord; compact?: boolean }) {
  if (compact) {
    return (
      <form action={signOut}>
        <Button type="submit" variant="ghost" size="icon" className="size-11" title={`Sign out ${user.email}`} aria-label="Sign out">
          <LogOut />
        </Button>
      </form>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border bg-background px-2 py-1.5">
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-xs font-medium">{user.name ?? user.email}</span>
        <span className="truncate text-[11px] text-muted-foreground">{user.isPlatformAdmin ? "Platform admin" : user.email}</span>
      </div>
      <form action={signOut}>
        <Button type="submit" variant="ghost" size="icon" className="size-8" title="Sign out" aria-label="Sign out">
          <LogOut />
        </Button>
      </form>
    </div>
  );
}
