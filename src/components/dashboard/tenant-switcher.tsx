"use client";

import { useTransition } from "react";
import { Building2, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { switchTenant } from "@/lib/tenant/actions";
import type { TenantOption } from "@/lib/types";
import { readableTextOn } from "@/lib/utils";

export function TenantSwitcher({ current, tenants }: { current: TenantOption; tenants: TenantOption[] }) {
  const [pending, startTransition] = useTransition();
  const color = current.primaryColor ?? "#1f2a44";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="h-11 w-full justify-between px-3"
          disabled={pending}
          aria-label={`Workspace: ${current.name}. Switch workspace`}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="flex size-6 shrink-0 items-center justify-center rounded-md"
              style={{ backgroundColor: color, color: readableTextOn(color) }}
              aria-hidden="true"
            >
              <Building2 className="size-3.5" />
            </span>
            <span className="flex min-w-0 flex-col items-start leading-tight">
              <span className="truncate text-sm font-medium">{current.name}</span>
              <span className="text-[11px] text-muted-foreground">{pending ? "Switching…" : "Workspace"}</span>
            </span>
          </span>
          <ChevronsUpDown className="size-4 text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={current.id} onValueChange={(id) => startTransition(() => switchTenant(id))}>
          {tenants.map((t) => (
            <DropdownMenuRadioItem key={t.id} value={t.id}>
              <span className="size-2.5 rounded-full" style={{ backgroundColor: t.primaryColor ?? "var(--muted-foreground)" }} aria-hidden="true" />
              <span className="flex-1 truncate">{t.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
