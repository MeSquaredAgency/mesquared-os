import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionProps {
  /** Labels the section for assistive tech; the headline gets this id. */
  id: string;
  kicker?: string;
  title: ReactNode;
  lede?: ReactNode;
  /** One action at the right of the header: a line button or a pair of numbers. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** The page rhythm: kicker → headline → lede → content, one idea per section. */
export function Section({ id, kicker, title, lede, action, children, className }: SectionProps) {
  return (
    <section aria-labelledby={id} className={cn("flex flex-col gap-5", className)}>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between sm:gap-8">
        <div className="flex flex-col gap-2">
          {kicker && <p className="kicker">{kicker}</p>}
          <h2 id={id} className="headline">
            {title}
          </h2>
          {lede && <p className="lede text-base">{lede}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      {children}
    </section>
  );
}

interface StatProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "green" | "red" | "neutral";
}

/** One number with its label, for a `StatStrip`. Colour only for money direction and risk. */
export function Stat({ label, value, hint, tone = "neutral" }: StatProps) {
  return (
    <div className="flex flex-col gap-2 bg-card px-6 py-5">
      <dt className="kicker text-xs">{label}</dt>
      <dd className={cn("display-sm", tone === "green" && "text-green-text", tone === "red" && "text-red-text")}>{value}</dd>
      {hint && <dd className="text-sm text-muted-foreground">{hint}</dd>}
    </div>
  );
}

/** Numbers side by side, separated by hairlines rather than boxes. */
export function StatStrip({ children, columns = 3, label }: { children: ReactNode; columns?: 2 | 3 | 4 | 5; label?: string }) {
  const cols = { 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 xl:grid-cols-4", 5: "sm:grid-cols-2 xl:grid-cols-5" }[columns];
  return (
    <dl aria-label={label} className={cn("grid gap-px overflow-hidden rounded-xl border bg-border", cols)}>
      {children}
    </dl>
  );
}
