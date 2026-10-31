import * as React from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "ok" | "error" | "info";

const STYLE: Record<Tone, string> = {
  ok: "bg-green-soft text-green-text",
  error: "bg-red-soft text-red-text",
  info: "bg-muted text-foreground",
};
const ICON: Record<Tone, React.ElementType> = { ok: CheckCircle2, error: AlertTriangle, info: Info };

/** The one-line result of an action, announced to assistive tech. */
function Notice({ tone = "info", className, children, ...props }: React.ComponentProps<"p"> & { tone?: Tone }) {
  const Icon = ICON[tone];
  return (
    <p role="status" aria-live="polite" className={cn("flex items-start gap-2.5 rounded-md px-3.5 py-2.5 text-sm", STYLE[tone], className)} {...props}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

export { Notice };
export type { Tone as NoticeTone };
