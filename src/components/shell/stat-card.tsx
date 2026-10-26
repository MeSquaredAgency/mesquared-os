import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** One number with its label: the label as a kicker in sentence case, the number large and tabular, colour only for money direction and risk. */
export function StatCard({ label, value, hint, tone = "neutral", icon }: { label: string; value: string | number; hint?: string; tone?: "green" | "red" | "neutral"; icon?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border bg-card px-6 py-5 text-card-foreground">
      <dl className="flex min-h-[4.5rem] flex-col gap-1.5">
        <dt className="kicker text-xs">{label}</dt>
        <dd className={cn("mt-auto text-3xl num", tone === "green" && "text-green-text", tone === "red" && "text-red-text")}>{value}</dd>
        {hint && <dd className="text-sm text-muted-foreground">{hint}</dd>}
      </dl>
      {icon && (
        <span aria-hidden="true" className={cn("flex size-10 shrink-0 items-center justify-center rounded-full", tone === "green" && "bg-green-soft text-green-text", tone === "red" && "bg-red-soft text-red-text", tone === "neutral" && "bg-muted text-muted-foreground")}>
          {icon}
        </span>
      )}
    </div>
  );
}
