import * as React from "react";
import { cn } from "@/lib/utils";

export const fieldClass =
  "flex h-10 w-full min-w-0 rounded-md border border-input bg-card px-3.5 text-sm text-foreground shadow-[0_1px_2px_#1b232c0a] transition-[border-color,box-shadow] duration-200 outline-none placeholder:text-subtle-foreground hover:border-foreground/50 focus-visible:border-ring focus-visible:shadow-[0_0_0_4px_color-mix(in_srgb,var(--ring)_18%,transparent)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-red";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return <input type={type} data-slot="input" className={cn(fieldClass, "py-1", className)} {...props} />;
}

export { Input };
