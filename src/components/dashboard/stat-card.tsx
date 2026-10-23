import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
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
    <Card className="gap-2 py-4">
      <CardContent className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
          <span className={cn("text-2xl font-semibold tabular-nums", tone === "green" && "text-green", tone === "red" && "text-red")}>
            {value}
          </span>
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        </div>
        {icon && (
          <span
            className={cn(
              "flex size-9 items-center justify-center rounded-lg",
              tone === "green" && "bg-green-soft text-green",
              tone === "red" && "bg-red-soft text-red",
              tone === "neutral" && "bg-muted text-muted-foreground",
            )}
          >
            {icon}
          </span>
        )}
      </CardContent>
    </Card>
  );
}
