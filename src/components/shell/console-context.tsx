"use client";

import { usePathname } from "next/navigation";
import type { TenantOption } from "@/lib/types";
import { WorkspaceSwitcher } from "./workspace-switcher";

/**
 * Under the brand in the console sidebar: inside a workspace, a switcher that
 * keeps the page and tab you are on; everywhere else, the console label.
 */
export function ConsoleContext({ workspaces, summary }: { workspaces: TenantOption[]; summary: string }) {
  const pathname = usePathname();
  const slug = pathname.split("/")[2];
  const current = workspaces.find((w) => w.slug === slug);

  if (current) {
    return <WorkspaceSwitcher current={current} options={workspaces} basePath="/console" noun="workspace" keep={["/settings"]} keepQuery={["tab", "section", "view"]} exit={{ href: "/console", label: "All workspaces" }} />;
  }

  return (
    <div className="flex h-12 items-center gap-2.5 rounded-lg border border-sidebar-border bg-sidebar-active px-2.5 shadow-[0_1px_2px_#1b232c0f]">
      <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-[linear-gradient(135deg,#1b3853,#2d5a86)] shadow-[inset_0_0_0_1px_#ffffff1f]">
        <span className="block size-2 bg-coral" />
      </span>
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-sm font-medium">Operator console</span>
        <span className="truncate text-2xs text-sidebar-muted">{summary}</span>
      </div>
    </div>
  );
}
