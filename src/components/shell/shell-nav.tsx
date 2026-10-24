"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Boxes, FileCheck, Home, Inbox, LayoutGrid, Plus, Settings, TrendingDown, Users, Wallet, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Icons are referenced by key so server layouts can describe the nav without passing functions to the client. */
const ICONS = { home: Home, users: Users, trendingDown: TrendingDown, fileCheck: FileCheck, activity: Activity, layoutGrid: LayoutGrid, inbox: Inbox, wallet: Wallet, plus: Plus, settings: Settings, boxes: Boxes } satisfies Record<string, LucideIcon>;
export type NavIcon = keyof typeof ICONS;

export interface NavItem {
  href: string;
  label: string;
  hint?: string;
  icon: NavIcon;
  /** Match only the exact path (for a section's home) instead of any sub-path. */
  exact?: boolean;
  badge?: number;
}

export function ShellNav({ items, mobile = false }: { items: NavItem[]; mobile?: boolean }) {
  const pathname = usePathname();
  const isActive = (item: NavItem) => (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`));

  if (mobile) {
    return (
      <nav aria-label="Main" className="flex gap-1 overflow-x-auto border-b bg-sidebar px-2 py-1.5">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(item);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn("flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm", active ? "bg-background font-medium text-foreground shadow-xs" : "text-muted-foreground")}
            >
              <Icon className="size-4" aria-hidden="true" />
              {item.label}
              {item.badge ? <span className="rounded-full bg-red-soft px-1.5 text-[10px] font-semibold text-red-text">{item.badge}</span> : null}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(item);
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
            <Icon className="size-4" aria-hidden="true" />
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span>{item.label}</span>
              {item.hint && <span className="text-[11px] font-normal text-muted-foreground">{item.hint}</span>}
            </span>
            {item.badge ? <span className="rounded-full bg-red-soft px-1.5 text-[10px] font-semibold text-red-text">{item.badge}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
