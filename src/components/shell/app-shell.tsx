import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { dataMode } from "@/lib/data";
import type { UserRecord } from "@/lib/types";
import { ShellNav, type NavItem } from "./shell-nav";
import { UserMenu } from "./user-menu";

export type Tone = "paper" | "abyss";

interface Props {
  user: UserRecord;
  nav: NavItem[];
  /** Paper for the client portal, abyss for the operator console. */
  tone?: Tone;
  /** Rendered under the brand in the sidebar: a workspace switcher, or a console label. */
  context?: React.ReactNode;
  /** Small print at the bottom of the sidebar. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}

/** The Me² mark: colour on paper, reversed on abyss. Never set in type. */
export function BrandMark({ tone, className = "h-6" }: { tone: Tone; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={tone === "abyss" ? "/brand/me2-logo-light.svg" : "/brand/me2-logo.svg"} alt="Me²" className={`${className} w-auto`} />;
}

/** The chrome shared by the Operator Console and the Client Portal. */
export function AppShell({ user, nav, tone = "paper", context, footer, children }: Props) {
  return (
    <div data-theme={tone} className="flex min-h-screen bg-background text-foreground">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-card focus:px-4 focus:py-2 focus:text-sm">
        Skip to content
      </a>

      <aside className="hidden w-72 shrink-0 flex-col gap-7 border-r bg-sidebar px-5 py-6 md:flex">
        <Link href="/" className="flex items-center gap-3 px-1" aria-label="MeSquared OS home">
          <BrandMark tone={tone} />
          <span className="text-sm text-muted-foreground">OS</span>
        </Link>
        {context}
        <ShellNav items={nav} />
        <div className="mt-auto flex flex-col gap-3">
          <UserMenu user={user} />
          <div className="flex flex-col gap-2 px-1 text-xs text-muted-foreground">
            {(user.isOperator || user.isPlatformAdmin) && (
              <div className="flex items-center justify-between">
                <span>Data source</span>
                <Badge variant={dataMode === "postgres" ? "muted" : "secondary"}>{dataMode === "postgres" ? "PostgreSQL" : "Demo"}</Badge>
              </div>
            )}
            {footer}
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-col md:hidden">
          <div className="flex h-16 items-center gap-3 border-b bg-sidebar px-4">
            <Link href="/" aria-label="MeSquared OS home">
              <BrandMark tone={tone} className="h-5" />
            </Link>
            <div className="ml-auto flex items-center gap-2">
              <div className="w-48">{context}</div>
              <UserMenu user={user} compact />
            </div>
          </div>
          <ShellNav items={nav} mobile />
        </header>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1320px] flex-1 px-5 py-6 outline-none md:px-10 md:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
