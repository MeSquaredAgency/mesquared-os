import * as React from "react";
import { cn } from "@/lib/utils";

/** A panel: cream on paper, raised navy on abyss, a hairline, the panel radius. No drop shadow; whitespace does the separating. */
function Card({ className, ...props }: React.ComponentProps<"section">) {
  return <section data-slot="card" className={cn("flex flex-col gap-5 rounded-xl border bg-card py-6 text-card-foreground", className)} {...props} />;
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-header" className={cn("flex flex-col gap-1.5 px-6", className)} {...props} />;
}

/** Renders an h2 by default so page outlines read h1 → h2 → h3. */
function CardTitle({ className, as: Tag = "h2", ...props }: React.ComponentProps<"h2"> & { as?: "h2" | "h3" | "div" }) {
  return <Tag data-slot="card-title" className={cn("text-lg leading-tight", className)} {...props} />;
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="card-description" className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("px-6", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-footer" className={cn("flex items-center px-6", className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
