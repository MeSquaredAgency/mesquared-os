import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A label above its control, with an optional hint under it. Wrap one
 * control per Field; the label element makes the whole block clickable.
 */
function Field({ label, hint, className, children, ...props }: React.ComponentProps<"label"> & { label: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5", className)} {...props}>
      <span className="text-xs font-medium text-foreground">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

/** A checkbox or switch-style row: control first, then the words. */
function CheckField({ label, hint, className, children, ...props }: React.ComponentProps<"label"> & { label: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label className={cn("flex items-start gap-2.5 text-sm", className)} {...props}>
      <span className="mt-0.5 flex shrink-0 items-center [&_input]:size-4 [&_input]:accent-[var(--navy)]">{children}</span>
      <span className="flex flex-col">
        <span className="font-medium">{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

/** A responsive grid for a group of fields. */
function FieldGrid({ className, columns = 2, ...props }: React.ComponentProps<"div"> & { columns?: 1 | 2 | 3 }) {
  const cols = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" }[columns];
  return <div className={cn("grid gap-4", cols, className)} {...props} />;
}

export { Field, CheckField, FieldGrid };
