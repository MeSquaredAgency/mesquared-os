"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronsUpDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { TenantOption } from "@/lib/types";
import { cn, readableTextOn } from "@/lib/utils";

/** The business's own mark: its colour, its initial. */
export function Mark({ tenant, className }: { tenant: TenantOption; className?: string }) {
  const color = tenant.primaryColor ?? "#1b3853";
  return (
    <span data-slot="mark" className={cn("flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold shadow-[inset_0_0_0_1px_#ffffff1f,0_1px_2px_#1b232c1f]", className)} style={{ backgroundColor: color, color: readableTextOn(color) }} aria-hidden="true">
      {tenant.name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

interface Props {
  current: TenantOption;
  options: TenantOption[];
  /** e.g. "/app"; the slug is appended. */
  basePath: string;
  /** "business" in the client portal, "workspace" in the console. */
  noun?: "business" | "workspace";
  /** Sub-paths every workspace has (e.g. "/leads"), kept when switching so you land on the same page. */
  keep?: string[];
  /** Query parameters kept when switching (e.g. the console tab). */
  keepQuery?: string[];
  /** A way out under the list: all workspaces, or back to the console. */
  exit?: { href: string; label: string };
}

/** Navigates between workspaces the user can open. The workspace lives in the URL, never in a cookie. */
export function WorkspaceSwitcher({ current, options, basePath, noun = "business", keep = [], keepQuery = [], exit }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const single = options.length <= 1;
  const plural = noun === "business" ? "businesses" : "workspaces";

  const hrefFor = (slug: string) => {
    const prefix = `${basePath}/${current.slug}`;
    const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
    const path = keep.some((k) => rest === k || rest.startsWith(`${k}/`)) ? rest : "";
    const query = new URLSearchParams();
    for (const key of keepQuery) {
      const value = search.get(key);
      if (value) query.set(key, value);
    }
    const qs = query.toString();
    return `${basePath}/${slug}${path}${qs ? `?${qs}` : ""}`;
  };

  const trigger = (
    <button
      type="button"
      className={cn("flex h-12 w-full items-center gap-2.5 rounded-lg border border-sidebar-border bg-sidebar-active px-2.5 text-left shadow-[0_1px_2px_#1b232c0f] outline-none transition-[border-color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", !(single && !exit) && "hover:border-border-strong hover:shadow-[0_2px_6px_#1b232c14]")}
      aria-label={`${noun === "business" ? "Business" : "Workspace"}: ${current.name}${single && !exit ? "" : `. Switch ${noun}`}`}
      disabled={single && !exit}
    >
      <Mark tenant={current} className="size-8 rounded-lg text-sm" />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-sm font-medium">{current.name}</span>
        <span className="truncate text-2xs text-sidebar-muted">{single ? (noun === "business" ? "Your business" : "Workspace") : `${options.length} ${plural}`}</span>
      </span>
      {!(single && !exit) && <ChevronsUpDown className="size-4 shrink-0 text-sidebar-muted" aria-hidden="true" />}
    </button>
  );

  if (single && !exit) return trigger;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[min(28rem,var(--radix-dropdown-menu-content-available-height))] w-64 overflow-y-auto">
        {!single && (
          <>
            <DropdownMenuLabel>Switch {noun}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={current.slug} onValueChange={(slug) => router.push(hrefFor(slug))}>
              {options.map((t) => (
                <DropdownMenuRadioItem key={t.id} value={t.slug}>
                  <Mark tenant={t} className="size-5 rounded-sm text-[10px]" />
                  <span className="flex-1 truncate">{t.name}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </>
        )}
        {exit && (
          <>
            {!single && <DropdownMenuSeparator />}
            <DropdownMenuItem asChild>
              <Link href={exit.href}>
                <ArrowLeft aria-hidden="true" />
                {exit.label}
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
