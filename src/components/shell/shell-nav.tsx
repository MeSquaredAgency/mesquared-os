"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Boxes, FileCheck, Home, Inbox, LayoutGrid, ListChecks, MessageSquare, MoreHorizontal, Plus, Settings, TrendingDown, Users, Wallet, type LucideIcon } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { isNavActive, type NavMatch } from "@/lib/nav";
import { cn } from "@/lib/utils";

/** Icons are referenced by key so server layouts can describe the nav without passing functions to the client. */
const ICONS = { home: Home, users: Users, trendingDown: TrendingDown, fileCheck: FileCheck, activity: Activity, layoutGrid: LayoutGrid, inbox: Inbox, wallet: Wallet, plus: Plus, settings: Settings, boxes: Boxes, listChecks: ListChecks, messageSquare: MessageSquare } satisfies Record<string, LucideIcon>;
export type NavIcon = keyof typeof ICONS;

export interface NavItem extends NavMatch {
  label: string;
  /** A short word for the phone tab bar when the label is long. */
  short?: string;
  hint?: string;
  icon: NavIcon;
  badge?: number;
}

function useActive(items: NavItem[]) {
  const pathname = usePathname();
  return (item: NavItem) => isNavActive(pathname, item, items);
}

/** A small pulse on a link whose page is on its way, so a slow server render never feels like a dead click. */
export function PendingMark({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  return pending ? <span aria-hidden="true" className={cn("size-1.5 shrink-0 animate-pulse rounded-full bg-brand", className)} /> : null;
}

const Count = ({ n }: { n: number }) => <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-soft px-1.5 text-2xs font-semibold text-red-text num">{n}</span>;

/** The sidebar list. The active item is raised on the card tone with the coral mark; the rest are quiet until hovered. */
export function ShellNav({ items }: { items: NavItem[] }) {
  const isActive = useActive(items);
  return (
    <nav aria-label="Main" className="flex flex-col gap-1 px-4 py-2">
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
              "group relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-[background-color,color,box-shadow] duration-150",
              active ? "bg-sidebar-active font-medium text-sidebar-foreground shadow-[0_1px_2px_#1b232c14,0_0_0_1px_var(--sidebar-border)]" : "text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-foreground",
            )}
          >
            <Icon className={cn("size-[18px] shrink-0 transition-colors", active && "text-brand")} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            <PendingMark />
            {item.badge ? <Count n={item.badge} /> : null}
            {active && <span aria-hidden="true" className="absolute top-1/2 -left-4 h-5 w-0.5 -translate-y-1/2 rounded-full bg-brand" />}
          </Link>
        );
      })}
    </nav>
  );
}

/** The phone tab bar: up to four items, the rest behind "More". */
export function MobileNav({ items }: { items: NavItem[] }) {
  const isActive = useActive(items);
  const shown = items.length > 5 ? items.slice(0, 4) : items;
  const more = items.length > 5 ? items.slice(4) : [];
  const moreActive = more.some(isActive);
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/90 shadow-[0_-8px_24px_-16px_#1b232c33] backdrop-blur-md md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)", paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}>
      <ul className="flex h-16 items-stretch">
        {shown.map((item) => {
          const Icon = ICONS[item.icon];
          const active = isActive(item);
          return (
            <li key={item.href} className="min-w-0 flex-1">
              <Link href={item.href} aria-current={active ? "page" : undefined} className={cn("relative flex h-full flex-col items-center justify-center gap-1 px-1 text-2xs font-medium transition-colors", active ? "text-foreground" : "text-muted-foreground")}>
                <span className={cn("relative grid h-7 w-11 place-items-center rounded-full transition-colors", active && "bg-accent")}>
                  <Icon className={cn("size-5", active && "text-brand")} aria-hidden="true" />
                  {item.badge ? <span className="absolute -top-1 right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-soft px-1 text-[10px] font-semibold text-red-text num">{item.badge}</span> : null}
                </span>
                <span className="max-w-full truncate">{item.short ?? item.label}</span>
                <PendingMark className="absolute top-2 right-[calc(50%-1.25rem)]" />
              </Link>
            </li>
          );
        })}
        {more.length > 0 && (
          <li className="min-w-0 flex-1">
            <DropdownMenu>
              <DropdownMenuTrigger className={cn("relative flex h-full w-full flex-col items-center justify-center gap-1 px-1 text-2xs font-medium outline-none", moreActive ? "text-foreground" : "text-muted-foreground")}>
                <span className={cn("grid h-7 w-11 place-items-center rounded-full", moreActive && "bg-accent")}>
                  <MoreHorizontal className={cn("size-5", moreActive && "text-brand")} aria-hidden="true" />
                </span>
                More
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
