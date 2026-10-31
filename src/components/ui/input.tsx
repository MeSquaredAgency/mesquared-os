import * as React from "react";
import { cn } from "@/lib/utils";

export const fieldClass =
  "flex h-9 w-full min-w-0 rounded-md border border-input bg-card px-3 text-sm text-foreground transition-colors duration-200 outline-none placeholder:text-subtle-foreground hover:border-foreground/60 focus-visible:border-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-red";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return <input type={type} data-slot="input" className={cn(fieldClass, "py-1", className)} {...props} />;
}

export { Input };
