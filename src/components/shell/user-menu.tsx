import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";
import type { UserRecord } from "@/lib/types";

export function UserMenu({ user, compact = false }: { user: UserRecord; compact?: boolean }) {
  if (compact) {
    return (
      <form action={signOut}>
        <Button type="submit" variant="ghost" size="icon" title={`Sign out ${user.email}`} aria-label="Sign out">
          <LogOut />
        </Button>
      </form>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border bg-card px-3 py-2">
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-sm font-medium">{user.name ?? user.email}</span>
        <span className="truncate text-xs text-muted-foreground">{user.isPlatformAdmin ? "Platform admin" : user.email}</span>
      </div>
      <form action={signOut}>
        <Button type="submit" variant="ghost" size="icon" className="size-9" title="Sign out" aria-label="Sign out">
          <LogOut />
        </Button>
      </form>
    </div>
  );
}
