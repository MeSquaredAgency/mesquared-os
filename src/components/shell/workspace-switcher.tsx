"use client";

import { useRouter } from "next/navigation";
import { Building2, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { TenantOption } from "@/lib/types";
import { readableTextOn } from "@/lib/utils";

/** Navigates between workspaces the user can open. The workspace lives in the URL, never in a cookie. */
export function WorkspaceSwitcher({ current, options, basePath }: { current: TenantOption; options: TenantOption[]; /** e.g. "/app"; the slug is appended. */ basePath: string }) {
  const router = useRouter();
  const color = current.primaryColor ?? "#1f2a44";
  const single = options.length <= 1;

  const trigger = (
    <Button variant="outline" className="h-11 w-full justify-between px-3" aria-label={`Workspace: ${current.name}${single ? "" : ". Switch workspace"}`} disabled={single}>
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: color, color: readableTextOn(color) }} aria-hidden="true">
          <Building2 className="size-3.5" />
        </span>
        <span className="flex min-w-0 flex-col items-start leading-tight">
          <span className="truncate text-sm font-medium">{current.name}</span>
          <span className="text-[11px] text-muted-foreground">Workspace</span>
        </span>
      </span>
      {!single && <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden="true" />}
    </Button>
  );

  if (single) return trigger;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={current.slug} onValueChange={(slug) => router.push(`${basePath}/${slug}`)}>
          {options.map((t) => (
            <DropdownMenuRadioItem key={t.id} value={t.slug}>
              <span className="size-2.5 rounded-full" style={{ backgroundColor: t.primaryColor ?? "var(--muted-foreground)" }} aria-hidden="true" />
              <span className="flex-1 truncate">{t.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
