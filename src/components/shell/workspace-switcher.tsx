"use client";

import { useRouter } from "next/navigation";
import { ChevronsUpDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { TenantOption } from "@/lib/types";
import { cn, readableTextOn } from "@/lib/utils";

/** The business's own mark: its colour, its initial. */
function Mark({ tenant, className }: { tenant: TenantOption; className?: string }) {
  const color = tenant.primaryColor ?? "#1b3853";
  return (
    <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold", className)} style={{ backgroundColor: color, color: readableTextOn(color) }} aria-hidden="true">
      {tenant.name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** Navigates between workspaces the user can open. The workspace lives in the URL, never in a cookie. */
export function WorkspaceSwitcher({ current, options, basePath }: { current: TenantOption; options: TenantOption[]; /** e.g. "/app"; the slug is appended. */ basePath: string }) {
  const router = useRouter();
  const single = options.length <= 1;

  const trigger = (
    <button
      type="button"
      className={cn("flex h-11 w-full items-center gap-2.5 rounded-md border border-sidebar-border bg-sidebar-active px-2 text-left outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", !single && "hover:border-border-strong")}
      aria-label={`Business: ${current.name}${single ? "" : ". Switch business"}`}
      disabled={single}
    >
      <Mark tenant={current} />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-sm font-medium">{current.name}</span>
        <span className="truncate text-2xs text-sidebar-muted">{single ? "Your business" : `${options.length} businesses`}</span>
      </span>
      {!single && <ChevronsUpDown className="size-4 shrink-0 text-sidebar-muted" aria-hidden="true" />}
    </button>
  );

  if (single) return trigger;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Switch business</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={current.slug} onValueChange={(slug) => router.push(`${basePath}/${slug}`)}>
          {options.map((t) => (
            <DropdownMenuRadioItem key={t.id} value={t.slug}>
              <Mark tenant={t} className="size-5 rounded-sm text-[10px]" />
              <span className="flex-1 truncate">{t.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
