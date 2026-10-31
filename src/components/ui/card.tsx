import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The one level of containment: a cream card with a hairline. Lists inside
 * use dividers, never nested cards. Padding is fixed at 20px (`p-5`).
 */
function Card({ className, ...props }: React.ComponentProps<"section">) {
  return <section data-slot="card" className={cn("surface flex flex-col text-card-foreground", className)} {...props} />;
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-header" className={cn("flex items-start justify-between gap-4 px-5 pt-5 pb-3", className)} {...props} />;
}

/** Renders an h2 by default so page outlines read h1 → h2 → h3. */
function CardTitle({ className, as: Tag = "h2", ...props }: React.ComponentProps<"h2"> & { as?: "h2" | "h3" | "div" }) {
  return <Tag data-slot="card-title" className={cn("section-title", className)} {...props} />;
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="card-description" className={cn("mt-0.5 text-sm text-muted-foreground", className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("px-5 pb-5", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-footer" className={cn("flex items-center gap-3 border-t px-5 py-3", className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
