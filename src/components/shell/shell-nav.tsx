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

const Count = ({ n }: { n: number }) => <span className="rounded-full bg-red-soft px-2 py-0.5 text-xs font-semibold text-red-text num">{n}</span>;

export function ShellNav({ items, mobile = false }: { items: NavItem[]; mobile?: boolean }) {
  const pathname = usePathname();
  const isActive = (item: NavItem) => (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`));

  if (mobile) {
    return (
      <nav aria-label="Main" className="flex gap-1 overflow-x-auto border-b bg-sidebar px-3 py-2">
        {items.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(item);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn("flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm transition-colors duration-300", active ? "bg-card font-medium text-foreground" : "text-muted-foreground")}
            >
              <Icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
              {item.label}
              {item.badge ? <Count n={item.badge} /> : null}
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
              "flex items-center gap-3 rounded-full px-4 py-2.5 text-sm transition-colors duration-300",
              active ? "bg-card font-medium text-foreground" : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
            )}
          >
            <Icon className="size-4" strokeWidth={1.75} aria-hidden="true" />
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span>{item.label}</span>
              {item.hint && <span className="text-xs font-normal text-muted-foreground">{item.hint}</span>}
            </span>
            {item.badge ? <Count n={item.badge} /> : null}
          </Link>
        );
      })}
    </nav>
  );
}
