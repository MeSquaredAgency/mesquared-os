"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Count } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PendingMark } from "./shell-nav";

export interface LinkTab {
  href: string;
  label: string;
  count?: number;
  /** Count shown in red when something needs a person. */
  urgent?: boolean;
}

/**
 * Underlined tabs that are links, so a view is a URL the server can render
 * and someone can share. Active when the path and the `tab` query match; an
 * unknown `tab` value falls back to the tab without one, as the server does.
 */
export function LinkTabs({ tabs, param = "tab", className }: { tabs: LinkTab[]; param?: string; className?: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const parse = (href: string) => {
    const [path, query = ""] = href.split("?");
    return { path, value: new URLSearchParams(query).get(param) ?? "" };
  };
  const known = tabs.map((t) => parse(t.href).value);
  const raw = search.get(param) ?? "";
  const current = known.includes(raw) ? raw : "";
  const isActive = (href: string) => {
    const { path, value } = parse(href);
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
            <PendingMark />
          </Link>
        );
      })}
    </nav>
  );
}
