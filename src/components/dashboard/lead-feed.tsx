import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { classifierLabel, leadDisplayName, ticketVariant } from "@/lib/leads";
import type { LeadRecord } from "@/lib/types";
import { humanize, timeAgo } from "@/lib/utils";
import { AutoRefresh } from "./auto-refresh";

export function LeadFeed({ leads }: { leads: LeadRecord[] }) {
  return (
    <Card aria-labelledby="lead-feed-title">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle id="lead-feed-title">Lead intake</CardTitle>
          <CardDescription className="mt-1">New enquiries from your forms and ad campaigns, classified as they arrive.</CardDescription>
        </div>
        <AutoRefresh />
      </CardHeader>
      <CardContent>
        {leads.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No leads yet. Connect a web form or ad lead form to this workspace to see them here.</p>
        ) : (
          <ul className="max-h-[70vh] divide-y overflow-y-auto">
            {leads.map((lead) => (
              <li key={lead.id} className="flex items-start gap-3 py-3">
                <Badge variant={ticketVariant(lead.ticketType)} className="mt-0.5 w-16 justify-center">
                  {lead.ticketType ? humanize(lead.ticketType) : "New"}
                </Badge>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium">{leadDisplayName(lead)}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(lead.createdAt)}</span>
                  </div>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{lead.message ?? "No message"}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {humanize(lead.source)} · intent {lead.intentScore ?? "–"}/100 · {classifierLabel(lead.qualifiedBy)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
