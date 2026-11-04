import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Chips. State chips carry a meaning that matters: they are tinted and lead
 * with a dot — `green` (done, healthy, money in), `red` (at risk, failed,
 * money out), `amber` (watch, pending), `secondary` (in flight, navy).
 * Attribute chips are quiet and dotless: `outline` for a tag, `muted` for
 * something finished or incidental.
 */
const badgeVariants = cva("inline-flex w-fit shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-2xs font-medium leading-none [&>svg]:size-3", {
  variants: {
    variant: {
      default: "border-transparent bg-primary text-primary-foreground",
      secondary: "border-transparent bg-blue-soft text-blue-text before:size-1.5 before:shrink-0 before:rounded-full before:bg-blue before:content-['']",
      outline: "border-border-strong bg-transparent text-muted-foreground",
      green: "border-transparent bg-green-soft text-green-text before:size-1.5 before:shrink-0 before:rounded-full before:bg-green before:content-['']",
      red: "border-transparent bg-red-soft text-red-text before:size-1.5 before:shrink-0 before:rounded-full before:bg-red before:content-['']",
      amber: "border-transparent bg-amber-soft text-amber-text before:size-1.5 before:shrink-0 before:rounded-full before:bg-amber before:content-['']",
      muted: "border-transparent bg-muted text-muted-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});

function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** A count in a pill, for nav items and tab labels. */
function Count({ n, tone = "neutral", className }: { n: number; tone?: "neutral" | "red"; className?: string }) {
  return (
    <span className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-2xs font-semibold num", tone === "red" ? "bg-red-soft text-red-text" : "bg-muted text-muted-foreground", className)}>
      {n}
    </span>
  );
}

export { Badge, Count, badgeVariants };
