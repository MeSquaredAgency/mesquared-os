import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ContentStudio } from "@/components/console/content-studio";
import { MoneyStudio } from "@/components/console/money-studio";
import { pacingStatus } from "@/lib/ads/sync";
import { readinessSummary, tenantReadiness } from "@/lib/launch/readiness";
import { OperationsPanels } from "@/components/console/operations-panels";
import { PageHeader, Section } from "@/components/shell/section";
import { HandledForYou } from "@/components/portal/handled-for-you";
import { MissedOpportunities } from "@/components/portal/missed-opportunities";
import { NeedsYou } from "@/components/portal/needs-you";
import { getConsoleContext } from "@/lib/auth/access";
import { AUTOMATION_BY_KEY } from "@/lib/automations/registry";
import { repository } from "@/lib/data";
import { MODULE_BY_KEY } from "@/lib/modules/registry";
import { summarizeChannels } from "@/lib/social/metrics";
import { leadDisplayName } from "@/lib/leads";
import { humanize } from "@/lib/utils";

export const metadata = { title: "Workspace" };

export default async function ConsoleTenantPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { tenants } = await getConsoleContext();
  const access = tenants.find((t) => t.tenant.slug === slug);
  if (!access) notFound();
  const tenant = access.tenant;
  const [home, config, bookings, requests, reviews, leads, workbench, snapshots, inbox] = await Promise.all([
    repository.getPortalHome(tenant.id, { timezone: tenant.timezone, currency: tenant.currency, onlyAssigneeId: null, canViewFinances: true }),
    repository.getTenantConfig(tenant.id),
    repository.listBookings(tenant.id, { status: ["SCHEDULED", "NO_SHOW"], limit: 20 }),
    repository.listInformationRequests(tenant.id),
    repository.listReviews(tenant.id, { limit: 10 }),
    repository.listRecentLeads(tenant.id, 50),
    repository.getWorkbench(tenant.id),
    repository.listChannelMetrics(tenant.id, { since: new Date(Date.now() - 14 * 86_400_000) }),
    repository.listInboxConversations(tenant.id, { limit: 40 }),
  ]);
  const [adAccounts, pacing, invoices, links] = await Promise.all([repository.listAdAccounts(tenant.id), pacingStatus(tenant), repository.listInvoices(tenant.id, { limit: 50 }), repository.listTrackedLinks(tenant.id, 30)]);
  const financeIntegrations = config.integrations.filter((i) => ["SQUARE", "STRIPE", "XERO", "QUICKBOOKS"].includes(i.provider));
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const inboxThreads = await Promise.all(inbox.map(async (conversation) => ({ conversation, messages: await repository.listMessages(tenant.id, conversation.id, 10) })));
  const draftCounts: Record<string, number> = {};
  for (const a of workbench.assets) if (a.parentId) draftCounts[a.parentId] = (draftCounts[a.parentId] ?? 0) + 1;
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
  const readiness = readinessSummary(await tenantReadiness(tenant));

  return (
    <div className="flex flex-col gap-12">
      <PageHeader
        kicker={`${humanize(tenant.industry)} · ${tenant.timezone}`}
        title={tenant.name}
        lede={
          <>
            {tenant.templateKey ? `${humanize(tenant.templateKey)} template. ` : "No template applied. "}
            <Link className="underline underline-offset-4" href={`/console/${tenant.slug}/settings`}>
              {readiness.ready ? "Ready to launch." : `Launch readiness: ${readiness.requiredPassed} of ${readiness.requiredTotal} required checks.`}
            </Link>
          </>
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/console/${tenant.slug}/settings`}>
                <Settings /> Settings
              </Link>
            </Button>
            <Button asChild>
              <Link href={`/app/${tenant.slug}`}>
                Open client portal <ArrowUpRight />
              </Link>
            </Button>
          </>
        }
      />

      <NeedsYou leads={home.needsYou} fmt={fmt} />
      <MissedOpportunities missed={home.missed} fmt={fmt} />

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

      <Section id="content-studio-title" title="Content and social" lede="Material in, drafts out, approvals, the publishing queue, the inbox and channel numbers.">
        <ContentStudio tenantId={tenant.id} fmt={fmt} sources={workbench.sources} drafts={workbench.assets} posts={workbench.posts} channels={summarizeChannels(workbench.channels, snapshots)} inbox={inboxThreads} draftCounts={draftCounts} />
      </Section>

      <Section id="money-studio-title" title="Money and marketing" lede="Ad accounts and pacing, finance connections and invoices, tracked links and website numbers.">
        <MoneyStudio tenantId={tenant.id} tenantSlug={tenant.slug} fmt={fmt} adAccounts={adAccounts} pacing={pacing} financeIntegrations={financeIntegrations} invoices={invoices} links={links} appUrl={appUrl} />
      </Section>

      <HandledForYou handled={home.handled} activityHref={`/app/${tenant.slug}/activity`} />
    </div>
  );
}
