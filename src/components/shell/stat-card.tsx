import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
  icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "green" | "red" | "neutral";
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border bg-card px-5 py-4 text-card-foreground shadow-xs">
      <dl className="flex flex-col gap-1">
        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
        <dd className={cn("text-2xl font-semibold tabular-nums", tone === "green" && "text-green-text", tone === "red" && "text-red-text")}>{value}</dd>
        {hint && <dd className="text-xs text-muted-foreground">{hint}</dd>}
      </dl>
      {icon && (
        <span
          aria-hidden="true"
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg",
            tone === "green" && "bg-green-soft text-green-text",
            tone === "red" && "bg-red-soft text-red-text",
            tone === "neutral" && "bg-muted text-muted-foreground",
          )}
        >
          {icon}
        </span>
      )}
    </div>
  );
}
