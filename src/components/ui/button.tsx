import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Me² buttons: full pills, a short verb in sentence case, and on the primary
 * one the coral square that turns on hover. One primary per group; pair it
 * with `outline` for the alternative and `ghost` for the quiet one. They lift
 * a hair under the pointer and settle when pressed.
 */
const buttonVariants = cva(
  "group inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-out active:translate-y-0 active:scale-[0.985] disabled:pointer-events-none disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_1px_2px_#1b232c33,0_6px_16px_-8px_#1b232c80] hover:bg-primary-hover hover:-translate-y-px hover:shadow-[0_2px_4px_#1b232c33,0_10px_24px_-8px_#1b232c80] after:size-1.5 after:shrink-0 after:bg-brand-on-primary after:transition-transform after:duration-300 after:content-[''] hover:after:rotate-90 hover:after:scale-125",
        destructive: "bg-destructive text-white shadow-[0_1px_2px_#1b232c33] hover:opacity-90",
        outline: "border border-border-strong bg-card text-foreground shadow-[0_1px_2px_#1b232c0f] hover:border-foreground/70 hover:-translate-y-px hover:shadow-[0_2px_6px_#1b232c1a]",
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
        ghost: "text-foreground hover:bg-accent",
        link: "h-auto px-0 text-foreground underline underline-offset-4 hover:text-muted-foreground",
      },
      size: {
        default: "h-9.5 px-4 text-sm",
        xs: "h-7 px-2.5 text-xs [&_svg]:size-3.5",
        sm: "h-8 px-3 text-sm",
        lg: "h-11 px-5 text-base",
        icon: "size-9",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
