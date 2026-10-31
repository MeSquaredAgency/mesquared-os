import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  /** A small line above the title: the surface, the date, the workspace. */
  eyebrow?: ReactNode;
  /** Older name for `eyebrow`. */
  kicker?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  /** Buttons at the right: one primary at most, the rest `outline` or `ghost`. */
  actions?: ReactNode;
  /** A row under the header: tabs, filters. */
  children?: ReactNode;
  className?: string;
}

/** The compact header every page opens with: eyebrow → title → one line, actions at the right. */
export function PageHeader({ eyebrow, kicker, title, lede, actions, children, className }: PageHeaderProps) {
  const label = eyebrow ?? kicker;
  return (
    <header className={cn("flex flex-col gap-4", className)}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-8">
        <div className="flex min-w-0 flex-col gap-1.5">
          {label && <p className="eyebrow">{label}</p>}
          <h1 className="page-title">{title}</h1>
          {lede && <p className="lede">{lede}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 md:pt-5">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

interface SectionProps {
  /** Labels the section for assistive tech; the title gets this id. */
  id: string;
  kicker?: string;
  title: ReactNode;
  lede?: ReactNode;
  /** One thing at the right of the header: a button, a count, a pair of numbers. */
  action?: ReactNode;
  /** h3 for a section nested inside another section's content. */
  level?: "h2" | "h3";
  children: ReactNode;
  className?: string;
}

/** The page rhythm: title → one line → content, one idea per section. */
export function Section({ id, kicker, title, lede, action, level = "h2", children, className }: SectionProps) {
  const Heading = level;
  return (
    <section aria-labelledby={id} className={cn("flex flex-col gap-3", className)}>
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
        <div className="flex min-w-0 flex-col gap-0.5">
          {kicker && <p className="eyebrow mb-1">{kicker}</p>}
          <Heading id={id} className="section-title">
            {title}
          </Heading>
          {lede && <p className="text-sm text-muted-foreground">{lede}</p>}
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </header>
      {children}
    </section>
  );
}

/** A cream card for a list or a table. Lists inside use `divide-y`. */
export function Panel({ children, className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("surface px-5 py-1 text-card-foreground", className)} {...props}>
      {children}
    </div>
  );
}

/** What a panel says when it has nothing to show. */
export function Empty({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("surface flex flex-col items-center gap-3 px-6 py-10 text-center", className)}>
      <p className="max-w-md text-sm text-muted-foreground">{children}</p>
      {action}
    </div>
  );
}

interface StatProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "green" | "red" | "amber" | "neutral";
  /** An ornament at the right: a chip, a small chart. */
  aside?: ReactNode;
}

/** One number with its label, for a `StatStrip`. Colour only for money direction and risk. */
export function Stat({ label, value, hint, tone = "neutral", aside }: StatProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 bg-card px-5 py-4">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="flex items-baseline justify-between gap-3">
        <span className={cn("stat-value truncate", tone === "green" && "text-green-text", tone === "red" && "text-red-text", tone === "amber" && "text-amber-text")}>{value}</span>
        {aside}
      </dd>
      {hint && <dd className="truncate text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}

/** Numbers side by side, separated by hairlines rather than boxes. */
export function StatStrip({ children, columns = 3, label, className }: { children: ReactNode; columns?: 2 | 3 | 4 | 5; label?: string; className?: string }) {
  // Odd counts fill their last row on a two-column phone grid so no empty cell shows through.
  const cols = {
    2: "grid-cols-2",
    3: "grid-cols-2 [&>*:nth-child(3)]:col-span-2 lg:grid-cols-3 lg:[&>*:nth-child(3)]:col-span-1",
    4: "grid-cols-2 xl:grid-cols-4",
    5: "grid-cols-2 [&>*:nth-child(5)]:col-span-2 xl:grid-cols-5 xl:[&>*:nth-child(5)]:col-span-1",
  }[columns];
  return (
    <dl role="group" aria-label={label} className={cn("surface grid gap-px overflow-hidden bg-border", cols, className)}>
      {children}
    </dl>
  );
}

/** A label and a value side by side, for a settings-style list. */
export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <li className={cn("flex items-center justify-between gap-4 py-3", className)}>{children}</li>;
}

/** Meta line under a list item: parts joined with middle dots. */
export function Meta({ parts, className }: { parts: ReactNode[]; className?: string }) {
  const shown = parts.filter((p) => p !== null && p !== undefined && p !== false && p !== "");
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      {shown.map((p, i) => (
        <span key={i}>
          {i > 0 && <span aria-hidden="true"> · </span>}
          {p}
        </span>
      ))}
    </p>
  );
}
