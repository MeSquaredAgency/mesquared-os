import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { UserRecord } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CommandMenu, CommandTrigger, type CommandGroup } from "./command-menu";
import { MobileNav, ShellNav, type NavItem } from "./shell-nav";
import { UserMenu } from "./user-menu";

export type Tone = "paper" | "abyss";

interface Props {
  user: UserRecord;
  nav: NavItem[];
  /** The sidebar's tone: abyss for the operator console, paper for the client portal. Content is always paper. */
  tone?: Tone;
  /** Under the brand in the sidebar: a workspace switcher, or a console label. */
  context?: React.ReactNode;
  /** Small print at the bottom of the sidebar. */
  footer?: React.ReactNode;
  /** Where the brand mark links to. */
  homeHref?: string;
  /** A way back to where the user came from, above the context (an operator in a client's portal). */
  back?: { href: string; label: string };
  /** More places for the "Jump to" menu; the nav itself is always listed first. */
  commands?: CommandGroup[];
  children: React.ReactNode;
}

/** The Me² mark: colour on paper, reversed on abyss. Never set in type. */
export function BrandMark({ tone, className = "h-5" }: { tone: Tone; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={tone === "abyss" ? "/brand/me2-logo-light.svg" : "/brand/me2-logo.svg"} alt="Me²" className={cn(className, "w-auto")} />;
}

/** The chrome shared by the Operator Console and the Client Portal. */
export function AppShell({ user, nav, tone = "paper", context, footer, homeHref = "/", back, commands = [], children }: Props) {
  const menuUser = { name: user.name ?? user.email, email: user.email, role: user.isPlatformAdmin ? "Platform admin" : user.isOperator ? "Operator" : user.email };
  const menuLinks = back ? [back] : [];
  const groups: CommandGroup[] = [{ label: "Go to", items: nav.map((item) => ({ href: item.href, label: item.label, hint: item.hint })) }, ...(back ? [{ label: "Elsewhere", items: [back] }] : []), ...commands];

  return (
    <div data-theme="paper" className="flex min-h-screen bg-background text-foreground">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-card focus:px-4 focus:py-2 focus:text-sm">
        Skip to content
      </a>

      <aside data-theme={tone} className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex h-14 items-center px-5">
          <Link href={homeHref} className="flex items-center gap-2" aria-label="MeSquared OS home">
            <BrandMark tone={tone} />
            <span className="text-xs font-medium tracking-wide text-sidebar-muted">OS</span>
          </Link>
        </div>
        <div className="flex flex-col gap-2 px-3 pb-2">
          {back && (
            <Link href={back.href} className="inline-flex w-fit items-center gap-1.5 rounded-md px-1 text-xs font-medium text-sidebar-muted hover:text-sidebar-foreground">
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              {back.label}
            </Link>
          )}
          {context}
          <CommandTrigger />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ShellNav items={nav} />
        </div>
        <div className="flex flex-col gap-2 border-t border-sidebar-border p-3">
          <UserMenu user={menuUser} links={menuLinks} />
          {footer && <div className="px-2 pb-1 text-2xs text-sidebar-muted">{footer}</div>}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header data-theme={tone} className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-sidebar-border bg-sidebar px-4 text-sidebar-foreground md:hidden">
          <Link href={homeHref} aria-label="MeSquared OS home" className="shrink-0">
            <BrandMark tone={tone} className="h-4.5" />
          </Link>
          <div className="ml-auto flex min-w-0 items-center gap-1.5">
            {context && <div className="min-w-0 max-w-52">{context}</div>}
            <CommandTrigger variant="icon" />
            <UserMenu user={menuUser} links={menuLinks} compact />
          </div>
        </header>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1200px] flex-1 px-4 pt-6 pb-24 outline-none md:px-8 md:pt-8 md:pb-16 lg:px-10">
          {children}
        </main>
        <MobileNav items={nav} />
      </div>
      <CommandMenu groups={groups} />
    </div>
  );
}
