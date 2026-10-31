import { LogOut } from "lucide-react";
import { Avatar } from "@/components/shell/avatar";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";
import type { UserRecord } from "@/lib/types";

/** Who is signed in, and the way out. Server component: the sign-out is a form action. */
export function UserMenu({ user, compact = false }: { user: UserRecord; compact?: boolean }) {
  if (compact) {
    return (
      <form action={signOut}>
        <Button type="submit" variant="ghost" size="icon-sm" title={`Sign out ${user.email}`} aria-label="Sign out">
          <LogOut />
        </Button>
      </form>
    );
  }
  return (
    <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
      <Avatar name={user.name ?? user.email} photoUrl={null} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-sm font-medium">{user.name ?? user.email}</span>
        <span className="truncate text-2xs text-sidebar-muted">{user.isPlatformAdmin ? "Platform admin" : user.isOperator ? "Operator" : user.email}</span>
      </div>
      <form action={signOut}>
        <Button type="submit" variant="ghost" size="icon-sm" className="text-sidebar-muted hover:text-sidebar-foreground" title="Sign out" aria-label="Sign out">
          <LogOut />
        </Button>
      </form>
    </div>
  );
}
