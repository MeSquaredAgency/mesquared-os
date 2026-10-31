"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Count } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface LinkTab {
  href: string;
  label: string;
  count?: number;
  /** Count shown in red when something needs a person. */
  urgent?: boolean;
}

/**
 * Underlined tabs that are links, so a view is a URL the server can render
 * and someone can share. Active when the path and the `tab` query match.
 */
export function LinkTabs({ tabs, param = "tab", className }: { tabs: LinkTab[]; param?: string; className?: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const current = search.get(param) ?? "";
  const isActive = (href: string) => {
    const [path, query = ""] = href.split("?");
    const value = new URLSearchParams(query).get(param) ?? "";
    return path === pathname && value === current;
  };
  return (
    <nav aria-label="Sections" className={cn("scrollbar-none -mx-4 flex items-end gap-1 overflow-x-auto border-b px-4 md:mx-0 md:px-0", className)}>
      {tabs.map((t) => {
        const active = isActive(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors duration-150 first:pl-0",
              active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {t.count ? <Count n={t.count} tone={t.urgent ? "red" : "neutral"} /> : null}
          </Link>
        );
      })}
    </nav>
  );
}
