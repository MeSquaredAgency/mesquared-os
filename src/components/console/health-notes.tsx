import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { HealthDeduction } from "@/lib/health";
import { cn } from "@/lib/utils";

/** Where an operator goes to fix each kind of deduction. */
function hrefFor(key: HealthDeduction["key"], base: string, slug: string): { href: string; verb: string } {
  switch (key) {
    case "exceptions":
      return { href: `/console/queue?workspace=${slug}`, verb: "Work the queue" };
    case "integrations":
      return { href: `${base}?tab=setup`, verb: "Check setup" };
    case "pacing":
      return { href: `${base}?tab=money`, verb: "See the money" };
    case "breaches":
    case "missed":
      return { href: `${base}#needs-you-title`, verb: "See who is waiting" };
  }
}

/**
 * The health score, unpacked: one line per deduction with the points it costs
 * and a link to the place that fixes it. Shown on the workspace overview so
 * an operator starts with the most expensive problem.
 */
export function HealthNotes({ deductions, base, slug, className }: { deductions: HealthDeduction[]; base: string; slug: string; className?: string }) {
  if (deductions.length === 0) return null;
  const sorted = [...deductions].sort((a, b) => b.points - a.points);
  return (
    <section aria-labelledby="health-notes-title" className={cn("surface flex flex-col gap-2 px-5 py-4", className)}>
      <h2 id="health-notes-title" className="eyebrow">
        What is costing points
      </h2>
      <ul className="flex flex-col divide-y">
        {sorted.map((d) => {
          const go = hrefFor(d.key, base, slug);
          return (
            <li key={d.key} className="flex items-center justify-between gap-4 py-2 text-sm">
              <span className="flex min-w-0 items-baseline gap-2.5">
                <span className="shrink-0 font-medium text-red-text num">−{d.points}</span>
                <span className="truncate first-letter:uppercase">{d.label}</span>
              </span>
              <Link href={go.href} className="inline-flex shrink-0 items-center gap-1 text-xs font-medium whitespace-nowrap text-muted-foreground hover:text-foreground hover:underline">
                {go.verb} <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
