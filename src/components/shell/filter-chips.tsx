"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Count } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PendingMark } from "./shell-nav";

export interface FilterChip {
  /** The query value; empty string (or omitted) is "everything". */
  value?: string;
  label: string;
  count?: number;
  /** Count shown in red when it needs a person. */
  urgent?: boolean;
}

/**
 * A row of pill links that set one query parameter, so a filtered view is a
 * URL the server renders and anyone can share. Chips with a count of zero
 * are shown but quiet; the active chip is solid.
 */
export function FilterChips({ param, chips, label, className }: { param: string; chips: FilterChip[]; label: string; className?: string }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const current = search.get(param) ?? "";
  const hrefFor = (value: string) => {
    const next = new URLSearchParams(search.toString());
    if (value) next.set(param, value);
    else next.delete(param);
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };
  return (
    <nav aria-label={label} className={cn("scrollbar-none -mx-4 flex items-center gap-1.5 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0", className)}>
      {chips.map((chip) => {
        const value = chip.value ?? "";
        const active = value === current;
        return (
          <Link
            key={value || "__all"}
            href={hrefFor(value)}
            scroll={false}
            aria-current={active ? "true" : undefined}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm whitespace-nowrap transition-colors duration-150",
              active ? "border-foreground bg-primary text-primary-foreground" : "border-border-strong bg-card text-muted-foreground hover:border-foreground hover:text-foreground",
              !active && chip.count === 0 && "opacity-70",
            )}
          >
            {chip.label}
            {chip.count !== undefined ? <Count n={chip.count} tone={chip.urgent && chip.count > 0 && !active ? "red" : "neutral"} className={cn(active && "bg-primary-foreground/15 text-primary-foreground")} /> : null}
            <PendingMark />
          </Link>
        );
      })}
    </nav>
  );
}
