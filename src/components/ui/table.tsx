import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A data table inside a card. The wrapper scrolls sideways on narrow screens;
 * numbers align right with `TD numeric`; the first column is the row's name.
 * The header row sits on a faint band so the columns read before the rows.
 */
function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="scrollbar-none w-full overflow-x-auto">
      <table className={cn("w-full min-w-[640px] border-collapse text-sm", className)} {...props} />
    </div>
  );
}

function THead({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("bg-accent/60 [&_tr]:border-b", className)} {...props} />;
}

function TBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("[&_tr:last-child]:border-0 [&_tr]:border-b", className)} {...props} />;
}

function TFoot({ className, ...props }: React.ComponentProps<"tfoot">) {
  return <tfoot className={cn("border-t font-medium [&_td]:py-3", className)} {...props} />;
}

function TR({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("transition-colors duration-150 hover:bg-accent/50", className)} {...props} />;
}

function TH({ className, numeric = false, ...props }: React.ComponentProps<"th"> & { numeric?: boolean }) {
  return <th scope="col" className={cn("h-10 px-3 text-left align-middle text-2xs font-medium whitespace-nowrap text-muted-foreground first:pl-5 last:pr-5", numeric && "text-right", className)} {...props} />;
}

function TD({ className, numeric = false, ...props }: React.ComponentProps<"td"> & { numeric?: boolean }) {
  return <td className={cn("px-3 py-3.5 align-middle first:pl-5 last:pr-5", numeric && "text-right num", className)} {...props} />;
}

export { Table, THead, TBody, TFoot, TR, TH, TD };
