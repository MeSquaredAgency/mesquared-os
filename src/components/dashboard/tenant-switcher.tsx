"use client";

import { useTransition } from "react";
import { Building2, ChevronsUpDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { switchTenant } from "@/lib/tenant/actions";
import type { TenantSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

export function TenantSwitcher({ current, tenants }: { current: TenantSummary; tenants: TenantSummary[] }) {
  const [pending, startTransition] = useTransition();
  const color = current.branding.primaryColor ?? "var(--primary)";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-11 w-full justify-between px-3" disabled={pending}>
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md text-white" style={{ backgroundColor: color }}>
              <Building2 className="size-3.5" />
            </span>
            <span className="flex min-w-0 flex-col items-start leading-tight">
              <span className="truncate text-sm font-medium">{current.name}</span>
              <span className="text-[11px] text-muted-foreground">{pending ? "Switching…" : "Workspace"}</span>
            </span>
          </span>
          <ChevronsUpDown className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {tenants.map((t) => (
          <DropdownMenuItem
            key={t.id}
            onSelect={() => startTransition(() => switchTenant(t.id))}
            className={cn(t.id === current.id && "font-medium")}
          >
            <span className="size-2.5 rounded-full" style={{ backgroundColor: t.branding.primaryColor ?? "var(--muted-foreground)" }} />
            <span className="flex-1 truncate">{t.name}</span>
            {t.id === current.id && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>Add workspace…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
