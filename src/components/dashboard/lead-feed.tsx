import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { LeadRecord } from "@/lib/types";
import { timeAgo } from "@/lib/utils";
import { humanize } from "./platform";

export function LeadFeed({ leads }: { leads: LeadRecord[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle>Lead intake</CardTitle>
          <CardDescription className="mt-1">Everything hitting /api/v1/intake, classified on arrival.</CardDescription>
        </div>
        <Badge variant="muted" className="gap-1.5">
          <span className="size-1.5 animate-pulse rounded-full bg-green" /> live
        </Badge>
      </CardHeader>
      <CardContent>
        {leads.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No leads yet. POST one to /api/v1/intake to see it here.</p>
        ) : (
          <ul className="divide-y">
            {leads.map((lead) => {
              const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || lead.email || lead.phone || "Unknown";
              return (
                <li key={lead.id} className="flex items-start gap-3 py-3">
                  <Badge variant={lead.ticketType === "GREEN" ? "green" : lead.ticketType === "RED" ? "red" : "muted"} className="mt-0.5 w-14 justify-center">
                    {lead.ticketType ?? "NEW"}
                  </Badge>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium">{name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(lead.createdAt)}</span>
                    </div>
                    <p className="line-clamp-2 text-sm text-muted-foreground">{lead.message ?? "No message"}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {humanize(lead.source)} · score {lead.intentScore ?? "–"} · {lead.qualifiedBy ?? "unqualified"}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
