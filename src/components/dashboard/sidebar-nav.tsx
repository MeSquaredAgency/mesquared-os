"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, LayoutDashboard, Megaphone } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Tickets", icon: LayoutDashboard, hint: "Green vs red" },
  { href: "/marketing", label: "Marketing", icon: Megaphone, hint: "Create & approve" },
  { href: "/feed", label: "Live feed", icon: Activity, hint: "Leads & payments" },
];

function useActive() {
  const pathname = usePathname();
  return (href: string) => pathname === href || pathname.startsWith(`${href}/`);
}

/** Vertical navigation for the desktop sidebar. */
export function SidebarNav() {
  const isActive = useActive();
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {NAV.map((item) => {
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              active ? "bg-background font-medium text-foreground shadow-xs" : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
            )}
          >
            <item.icon className="size-4" aria-hidden="true" />
            <span className="flex flex-col leading-tight">
              <span>{item.label}</span>
              <span className="text-[11px] font-normal text-muted-foreground">{item.hint}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Horizontal navigation shown under the header on small screens. */
export function MobileNav() {
  const isActive = useActive();
  return (
    <nav aria-label="Main" className="flex gap-1 overflow-x-auto border-b bg-sidebar px-2 py-1.5 md:hidden">
      {NAV.map((item) => {
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm",
              active ? "bg-background font-medium text-foreground shadow-xs" : "text-muted-foreground",
            )}
          >
            <item.icon className="size-4" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
