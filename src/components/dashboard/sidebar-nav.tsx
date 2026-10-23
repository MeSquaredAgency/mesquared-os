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

export function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              active ? "bg-background font-medium text-foreground shadow-xs" : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
            )}
          >
            <item.icon className="size-4" />
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
