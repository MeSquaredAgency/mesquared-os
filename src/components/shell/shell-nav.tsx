"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Boxes, FileCheck, Home, Inbox, LayoutGrid, MoreHorizontal, Plus, Settings, TrendingDown, Users, Wallet, type LucideIcon } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** Icons are referenced by key so server layouts can describe the nav without passing functions to the client. */
const ICONS = { home: Home, users: Users, trendingDown: TrendingDown, fileCheck: FileCheck, activity: Activity, layoutGrid: LayoutGrid, inbox: Inbox, wallet: Wallet, plus: Plus, settings: Settings, boxes: Boxes } satisfies Record<string, LucideIcon>;
export type NavIcon = keyof typeof ICONS;

export interface NavItem {
  href: string;
  label: string;
  /** A short word for the phone tab bar when the label is long. */
  short?: string;
  hint?: string;
  icon: NavIcon;
  /** Match only the exact path (for a section's home) instead of any sub-path. */
  exact?: boolean;
  badge?: number;
}

function useActive() {
  const pathname = usePathname();
  return (item: NavItem) => (item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`));
}

const Count = ({ n }: { n: number }) => <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-soft px-1.5 text-2xs font-semibold text-red-text num">{n}</span>;

/** The sidebar list. The active item gets the card tone and the coral square. */
export function ShellNav({ items }: { items: NavItem[] }) {
  const isActive = useActive();
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 px-3 py-2">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            title={item.hint}
            className={cn(
              "group relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors duration-150",
              active ? "bg-sidebar-active font-medium text-sidebar-foreground" : "text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.badge ? <Count n={item.badge} /> : null}
            {active && <span aria-hidden="true" className="absolute top-1/2 -left-3 h-4 w-0.5 -translate-y-1/2 bg-brand" />}
          </Link>
        );
      })}
    </nav>
  );
}

/** The phone tab bar: up to four items, the rest behind "More". */
export function MobileNav({ items }: { items: NavItem[] }) {
  const isActive = useActive();
  const shown = items.length > 5 ? items.slice(0, 4) : items;
  const more = items.length > 5 ? items.slice(4) : [];
  const moreActive = more.some(isActive);
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 backdrop-blur md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <ul className="flex h-16 items-stretch">
        {shown.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(item);
          return (
            <li key={item.href} className="min-w-0 flex-1">
              <Link href={item.href} aria-current={active ? "page" : undefined} className={cn("relative flex h-full flex-col items-center justify-center gap-1 px-1 text-2xs font-medium", active ? "text-foreground" : "text-muted-foreground")}>
                <span className="relative">
                  <Icon className="size-5" aria-hidden="true" />
                  {item.badge ? <span className="absolute -top-1.5 -right-2.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-soft px-1 text-[10px] font-semibold text-red-text num">{item.badge}</span> : null}
                </span>
                <span className="max-w-full truncate">{item.short ?? item.label}</span>
                {active && <span aria-hidden="true" className="absolute top-0 h-0.5 w-8 bg-brand" />}
              </Link>
            </li>
          );
        })}
        {more.length > 0 && (
          <li className="min-w-0 flex-1">
            <DropdownMenu>
              <DropdownMenuTrigger className={cn("relative flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-2xs font-medium outline-none", moreActive ? "text-foreground" : "text-muted-foreground")}>
                <MoreHorizontal className="size-5" aria-hidden="true" />
                More
                {moreActive && <span aria-hidden="true" className="absolute top-0 h-0.5 w-8 bg-brand" />}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" sideOffset={10} className="w-56">
                {more.map((item) => {
                  const Icon = ICONS[item.icon];
                  return (
                    <DropdownMenuItem key={item.href} asChild>
                      <Link href={item.href} aria-current={isActive(item) ? "page" : undefined}>
                        <Icon className="size-4" aria-hidden="true" />
                        <span className="flex-1">{item.label}</span>
                        {item.badge ? <Count n={item.badge} /> : null}
                      </Link>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        )}
      </ul>
    </nav>
  );
}
