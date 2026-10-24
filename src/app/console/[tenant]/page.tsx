import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OperationsPanels } from "@/components/console/operations-panels";
import { HandledForYou } from "@/components/portal/handled-for-you";
import { MissedOpportunities } from "@/components/portal/missed-opportunities";
import { NeedsYou } from "@/components/portal/needs-you";
import { getConsoleContext } from "@/lib/auth/access";
import { AUTOMATION_BY_KEY } from "@/lib/automations/registry";
import { repository } from "@/lib/data";
import { MODULE_BY_KEY } from "@/lib/modules/registry";
import { leadDisplayName } from "@/lib/leads";
import { humanize } from "@/lib/utils";

export const metadata = { title: "Workspace" };

export default async function ConsoleTenantPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { tenants } = await getConsoleContext();
  const access = tenants.find((t) => t.tenant.slug === slug);
  if (!access) notFound();
  const tenant = access.tenant;
  const [home, config, bookings, requests, reviews, leads] = await Promise.all([
    repository.getPortalHome(tenant.id, { timezone: tenant.timezone, currency: tenant.currency, onlyAssigneeId: null, canViewFinances: true }),
    repository.getTenantConfig(tenant.id),
    repository.listBookings(tenant.id, { status: ["SCHEDULED", "NO_SHOW"], limit: 20 }),
    repository.listInformationRequests(tenant.id),
    repository.listReviews(tenant.id, { limit: 10 }),
    repository.listRecentLeads(tenant.id, 50),
  ]);
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const contactName = async (contactId: string | null, leadId: string | null) => {
    const lead = leadId ? leadById.get(leadId) : null;
    if (lead) return leadDisplayName(lead);
    const contact = contactId ? await repository.findContactById(tenant.id, contactId) : null;
    return contact ? leadDisplayName(contact) : "a contact";
  };
  const bookingRows = bookings.map((b) => ({ ...b, leadName: leadById.get(b.leadId) ? leadDisplayName(leadById.get(b.leadId)!) : "Lead" }));
  const requestRows = await Promise.all(requests.map(async (r) => ({ ...r, who: await contactName(r.contactId, r.leadId) })));
  const fmt = { timezone: tenant.timezone, locale: tenant.locale, currency: tenant.currency };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{tenant.name}</h1>
          <p className="text-sm text-muted-foreground">
            {humanize(tenant.industry)} · {tenant.templateKey ? `${tenant.templateKey.replace(/_/g, " ")} template` : "no template"} · {tenant.timezone}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/app/${tenant.slug}`}>
            Open client portal <ArrowUpRight />
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <NeedsYou leads={home.needsYou} fmt={fmt} />
        <MissedOpportunities missed={home.missed} fmt={fmt} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card aria-labelledby="integrations-title">
          <CardHeader>
            <CardTitle id="integrations-title">Integrations</CardTitle>
            <CardDescription>Connected systems and their state.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {config.integrations.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{i.label ?? humanize(i.provider)}</p>
                    {i.lastError && <p className="truncate text-xs text-red-text">{i.lastError}</p>}
                  </div>
                  <Badge variant={i.status === "CONNECTED" ? "green" : i.status === "PENDING" ? "outline" : "red"}>{humanize(i.status)}</Badge>
                </li>
              ))}
              {config.integrations.length === 0 && <li className="py-2 text-sm text-muted-foreground">Nothing connected yet.</li>}
            </ul>
          </CardContent>
        </Card>
        <Card aria-labelledby="modules-title">
          <CardHeader>
            <CardTitle id="modules-title">Modules</CardTitle>
            <CardDescription>What this workspace has switched on.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {config.modules.map((m) => (
                <li key={m.moduleKey} className="flex items-center justify-between gap-2 py-2">
                  <span className="text-sm">{MODULE_BY_KEY[m.moduleKey]?.name ?? m.moduleKey}</span>
                  <Badge variant={m.enabled ? "green" : "muted"}>{m.enabled ? "On" : "Off"}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card aria-labelledby="automations-title">
          <CardHeader>
            <CardTitle id="automations-title">Automations</CardTitle>
            <CardDescription>Reusable types enabled for this tenant.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {config.automations.map((a) => (
                <li key={a.typeKey} className="flex items-center justify-between gap-2 py-2">
                  <span className="text-sm">{AUTOMATION_BY_KEY[a.typeKey]?.name ?? a.typeKey}</span>
                  <Badge variant={a.enabled ? "green" : "muted"}>{a.enabled ? "On" : "Off"}</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <OperationsPanels tenantId={tenant.id} fmt={fmt} bookings={bookingRows} requests={requestRows} reviews={reviews} leads={leads} />

      <HandledForYou handled={home.handled} activityHref={`/app/${tenant.slug}/activity`} />
    </div>
  );
}
