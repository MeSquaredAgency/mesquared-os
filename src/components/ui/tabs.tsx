"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

/**
 * Two looks. `line` (default) is a row of underlined tabs for switching the
 * whole view; `segment` is a small pill group for switching within a card.
 */
const TabsVariant = React.createContext<"line" | "segment">("line");

function TabsList({ className, variant = "line", ...props }: React.ComponentProps<typeof TabsPrimitive.List> & { variant?: "line" | "segment" }) {
  return (
    <TabsVariant.Provider value={variant}>
      <TabsPrimitive.List
        className={cn(
          variant === "line" ? "scrollbar-none flex w-full items-end gap-1 overflow-x-auto border-b" : "scrollbar-none inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-muted p-1",
          className,
        )}
        {...props}
      />
    </TabsVariant.Provider>
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const variant = React.useContext(TabsVariant);
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-medium text-muted-foreground transition-colors duration-200 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        variant === "line"
          ? "-mb-px h-10 border-b-2 border-transparent px-3 first:pl-0 hover:text-foreground data-[state=active]:border-foreground data-[state=active]:text-foreground"
          : "h-8 rounded-full px-3.5 hover:text-foreground data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-[0_1px_2px_#1b232c14]",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("flex-1 pt-5 outline-none", className)} {...props} />;
}

/**
 * Keeps a client-side tab in the query string (`?param=value`), so a section
 * can be linked to and survives a reload, without a server round trip or a
 * history entry per click. Spread the result onto `Tabs`.
 */
function useQueryTab<T extends string>(param: string, values: readonly T[], fallback: T) {
  const search = useSearchParams();
  const raw = search.get(param);
  const value = values.includes(raw as T) ? (raw as T) : fallback;
  const onValueChange = React.useCallback(
    (next: string) => {
      const url = new URL(window.location.href);
      if (next === fallback) url.searchParams.delete(param);
      else url.searchParams.set(param, next);
      window.history.replaceState(null, "", url);
    },
    [param, fallback],
  );
  return { value, onValueChange };
}

export { Tabs, TabsList, TabsTrigger, TabsContent, useQueryTab };
