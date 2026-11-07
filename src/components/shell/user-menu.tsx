"use client";

import Link from "next/link";
import { useTransition } from "react";
import { ArrowLeftRight, Bell, BellOff, BellRing, ChevronsUpDown, LogOut } from "lucide-react";
import { Avatar } from "@/components/shell/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { signOut } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";
import { disablePush, enablePush, testPush, usePush } from "./push";

/** What the menu shows about the signed-in person; never the whole user record. */
export interface MenuUser {
  name: string;
  email: string;
  role: string;
}

/**
 * Who is signed in, where else they can go, and the way out. Signing out sits
 * behind the menu so a stray tap on a phone never ends the session.
 */
export function UserMenu({ user, links = [], compact = false }: { user: MenuUser; links?: { href: string; label: string }[]; compact?: boolean }) {
  const [pending, start] = useTransition();
  const push = usePush();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {compact ? (
          <button type="button" aria-label={`Account: ${user.name}`} className="rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            <Avatar name={user.name} photoUrl={null} size="sm" />
          </button>
        ) : (
          <button type="button" aria-label={`Account: ${user.name}`} className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-sidebar-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            <Avatar name={user.name} photoUrl={null} size="sm" />
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-sm font-medium">{user.name}</span>
              <span className="truncate text-2xs text-sidebar-muted">{user.role}</span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-sidebar-muted" aria-hidden="true" />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={compact ? "end" : "start"} side={compact ? "bottom" : "top"} className="w-60">
        <DropdownMenuLabel className="flex flex-col leading-tight">
          <span className="truncate text-sm font-medium text-foreground">{user.name}</span>
          {user.email !== user.name && <span className="truncate text-xs font-normal text-muted-foreground">{user.email}</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {links.map((link) => (
          <DropdownMenuItem key={link.href} asChild>
            <Link href={link.href}>
              <ArrowLeftRight aria-hidden="true" />
              {link.label}
            </Link>
          </DropdownMenuItem>
        ))}
        {links.length > 0 && <DropdownMenuSeparator />}
        {push.state === "on" ? (
          <>
            <DropdownMenuItem disabled={push.busy} onSelect={(e) => (e.preventDefault(), void testPush())}>
              <BellRing aria-hidden="true" />
              Send a test notification
            </DropdownMenuItem>
            <DropdownMenuItem disabled={push.busy} onSelect={(e) => (e.preventDefault(), void disablePush())}>
              <BellOff aria-hidden="true" />
              Turn off notifications here
            </DropdownMenuItem>
          </>
        ) : push.state === "off" ? (
          <DropdownMenuItem disabled={push.busy} onSelect={(e) => (e.preventDefault(), void enablePush())}>
            <Bell aria-hidden="true" />
            Turn on notifications
          </DropdownMenuItem>
        ) : push.state === "denied" ? (
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Notifications are blocked for this site in your browser settings.</DropdownMenuLabel>
        ) : push.state === "install" ? (
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">For notifications, add the OS to your Home Screen and open it from there.</DropdownMenuLabel>
        ) : null}
        {push.note && <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{push.note}</DropdownMenuLabel>}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={pending} onSelect={() => start(() => signOut())} className={cn(pending && "opacity-60")}>
          <LogOut aria-hidden="true" />
          {pending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
