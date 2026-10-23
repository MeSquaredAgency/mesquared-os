import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { dataMode } from "@/lib/data";
import type { UserRecord } from "@/lib/types";
import { ShellNav, type NavItem } from "./shell-nav";
import { UserMenu } from "./user-menu";

interface Props {
  user: UserRecord;
  nav: NavItem[];
  /** Rendered under the brand in the sidebar: a workspace switcher, or a console label. */
  context?: React.ReactNode;
  /** Small print at the bottom of the sidebar. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

/** The chrome shared by the Operator Console and the Client Portal. */
export function AppShell({ user, nav, context, footer, children }: Props) {
  return (
    <div className="flex min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:shadow"
      >
        Skip to content
      </a>

      <aside className="hidden w-64 shrink-0 flex-col gap-6 border-r bg-sidebar p-4 md:flex">
        <Link href="/" className="flex items-center gap-2 px-1">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground" aria-hidden="true">
            M²
          </span>
          <span className="text-sm font-semibold tracking-tight">MeSquared OS</span>
        </Link>
        {context}
        <ShellNav items={nav} />
        <div className="mt-auto flex flex-col gap-3">
          <UserMenu user={user} />
          <div className="flex flex-col gap-2 px-1 text-xs text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>Data source</span>
              <Badge variant={dataMode === "postgres" ? "muted" : "secondary"}>{dataMode === "postgres" ? "PostgreSQL" : "Demo"}</Badge>
            </div>
            {footer}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-col md:hidden">
          <div className="flex h-14 items-center gap-3 border-b px-4">
            <Link href="/" className="text-sm font-semibold">
              MeSquared OS
            </Link>
            <div className="ml-auto flex items-center gap-2">
              <div className="w-44">{context}</div>
              <UserMenu user={user} compact />
            </div>
          </div>
          <ShellNav items={nav} mobile />
        </header>
        <main id="main" tabIndex={-1} className="flex-1 p-4 outline-none md:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
