import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, Bot, Settings } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ContentStudio } from "@/components/console/content-studio";
import { MoneyStudio } from "@/components/console/money-studio";
import { OperationsPanels } from "@/components/console/operations-panels";
import { HealthBar } from "@/components/console/portfolio-table";
import { HealthNotes } from "@/components/console/health-notes";
import { healthBreakdown } from "@/lib/health";
import { HandledForYou } from "@/components/portal/handled-for-you";
import { MissedOpportunities } from "@/components/portal/missed-opportunities";
import { NeedsYou } from "@/components/portal/needs-you";
import { LinkTabs } from "@/components/shell/link-tabs";
import { PageHeader, Row, Section } from "@/components/shell/section";
import { StatusBadge } from "@/components/shell/status-badge";
import { pacingStatus } from "@/lib/ads/sync";
import { latestCallBriefs } from "@/lib/agents/briefs";
import { getConsoleContext } from "@/lib/auth/access";
import { AUTOMATION_BY_KEY } from "@/lib/automations/registry";
import { repository } from "@/lib/data";
import { readinessSummary, tenantReadiness } from "@/lib/launch/readiness";
import { leadDisplayName } from "@/lib/leads";
import { MODULE_BY_KEY } from "@/lib/modules/registry";
import { summarizeChannels } from "@/lib/social/metrics";
import type { IntegrationRecord, TenantSummary } from "@/lib/types";
import { humanize } from "@/lib/utils";
import { templateName } from "@/lib/templates";

export const metadata = { title: "Workspace" };

const TABS = ["overview", "operations", "content", "money", "setup"] as const;
type Tab = (typeof TABS)[number];

export default async function ConsoleTenantPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { tenant: slug } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(rawTab ?? "") ? (rawTab as Tab) : "overview";
  const { tenants } = await getConsoleContext();
  const access = tenants.find((t) => t.tenant.slug === slug);
  if (!access) notFound();
  const tenant = access.tenant;

  // The header needs the config, the portfolio row and the launch checks on every tab; the full portal home (a dozen
  // queries) only on the overview. The other tabs fetch just the "needs you" leads for the tab count.
  const config = await repository.getTenantConfig(tenant.id);
  const [portfolio, readiness, home, needsYouLeads] = await Promise.all([
    repository.getPortfolio([tenant]),
    tenantReadiness(tenant, config).then(readinessSummary),
    tab === "overview" ? repository.getPortalHome(tenant.id, { timezone: tenant.timezone, currency: tenant.currency, onlyAssigneeId: null, canViewFinances: true }) : null,
    tab === "overview" ? null : repository.listNeedsYou(tenant.id, { onlyAssigneeId: null, limit: 8 }),
  ]);
  const row = portfolio[0];
  const briefs = home ? await latestCallBriefs(tenant.id, home.needsYou.map((l) => l.id)) : {};
  const health = row?.health ?? null;
  const fmt = { timezone: tenant.timezone, locale: tenant.locale, currency: tenant.currency };
  const base = `/console/${tenant.slug}`;
  const failingIntegrations = config.integrations.filter((i) => i.status === "NEEDS_ATTENTION" || i.status === "DISCONNECTED").length;
  const contentDue = row?.contentDue ?? 0;
  const needsPerson = (home ? home.needsYou.length : (needsYouLeads?.length ?? 0)) + (row?.missedOpen ?? 0);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={
          <>
            <Link href="/console" className="hover:text-foreground hover:underline">
              Portfolio
            </Link>
            <span aria-hidden="true">/</span>
            {templateName(tenant.templateKey)}
          </>
        }
        title={tenant.name}
        lede={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {health !== null && row && <HealthBar score={health} deductions={healthBreakdown(row)} />}
            <span aria-hidden="true" className="hidden text-border-strong sm:inline">
              |
            </span>
            <span>{tenant.timezone.replace(/_/g, " ")}</span>
            <span aria-hidden="true" className="text-border-strong">
              |
            </span>
            <Link className="underline underline-offset-4 hover:text-foreground" href={`${base}/settings`}>
              {readiness.ready ? "Ready to launch" : `${readiness.requiredPassed} of ${readiness.requiredTotal} launch checks passed`}
            </Link>
          </span>
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`${base}/agents`}>
                <Bot /> Agents
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`${base}/settings`}>
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
      >
        <LinkTabs
          tabs={[
            { href: base, label: "Overview", count: needsPerson, urgent: needsPerson > 0 },
            { href: `${base}?tab=operations`, label: "Operations" },
            { href: `${base}?tab=content`, label: "Content", count: contentDue },
            { href: `${base}?tab=money`, label: "Money" },
            { href: `${base}?tab=setup`, label: "Setup", count: failingIntegrations, urgent: failingIntegrations > 0 },
          ]}
        />
      </PageHeader>

      {tab === "overview" && home && (
        <div className="flex flex-col gap-8">
          {row && <HealthNotes deductions={healthBreakdown(row)} base={base} slug={tenant.slug} />}
          <NeedsYou leads={home.needsYou} fmt={fmt} tenantSlug={tenant.slug} briefs={briefs} />
          <MissedOpportunities missed={home.missed} fmt={fmt} />
          <HandledForYou handled={home.handled} activityHref={`/app/${tenant.slug}/activity`} />
        </div>
      )}

      {tab === "operations" && <OperationsTab tenantId={tenant.id} fmt={fmt} />}

      {tab === "content" && <ContentTab tenantId={tenant.id} fmt={fmt} />}

      {tab === "money" && <MoneyTab tenant={tenant} fmt={fmt} integrations={config.integrations} />}

      {tab === "setup" && (
        <div className="grid gap-8 xl:grid-cols-3 xl:gap-6">
          <Section id="integrations-title" title="Integrations" lede="Connected systems and their state." action={<Button asChild variant="ghost" size="sm"><Link href={`${base}/settings`}>Manage</Link></Button>}>
            <ul className="surface divide-y px-5">
              {config.integrations.map((i) => (
                <Row key={i.id}>
                  <div className="min-w-0">
                    <p className="truncate text-sm">{i.label ?? humanize(i.provider)}</p>
                    {i.lastError && <p className="truncate text-xs text-red-text">{i.lastError}</p>}
                  </div>
                  <StatusBadge status={i.status} />
                </Row>
              ))}
              {config.integrations.length === 0 && <li className="py-4 text-sm text-muted-foreground">Nothing connected yet.</li>}
            </ul>
          </Section>
          <Section id="modules-title" title="Modules" lede="What this workspace has switched on.">
            <ul className="surface divide-y px-5">
              {config.modules.map((m) => (
                <Row key={m.moduleKey}>
                  <span className="text-sm">{MODULE_BY_KEY[m.moduleKey]?.name ?? m.moduleKey}</span>
                  <Badge variant={m.enabled ? "green" : "muted"}>{m.enabled ? "On" : "Off"}</Badge>
                </Row>
              ))}
            </ul>
          </Section>
          <Section id="automations-title" title="Automations" lede="Reusable types enabled for this workspace.">
            <ul className="surface divide-y px-5">
              {config.automations.map((a) => (
                <Row key={a.typeKey}>
                  <span className="text-sm">{AUTOMATION_BY_KEY[a.typeKey]?.name ?? a.typeKey}</span>
                  <Badge variant={a.enabled ? "green" : "muted"}>{a.enabled ? "On" : "Off"}</Badge>
                </Row>
              ))}
            </ul>
          </Section>
        </div>
      )}
    </div>
  );
}

type Fmt = { timezone: string; locale: string; currency: string };

async function OperationsTab({ tenantId, fmt }: { tenantId: string; fmt: Fmt }) {
  const [bookings, requests, reviews, leads] = await Promise.all([
    repository.listBookings(tenantId, { status: ["SCHEDULED", "NO_SHOW"], limit: 20 }),
    repository.listInformationRequests(tenantId),
    repository.listReviews(tenantId, { limit: 10 }),
    repository.listRecentLeads(tenantId, 50),
  ]);
  const leadById = new Map(leads.map((l) => [l.id, l]));
  const contactName = async (contactId: string | null, leadId: string | null) => {
    const lead = leadId ? leadById.get(leadId) : null;
    if (lead) return leadDisplayName(lead);
    const contact = contactId ? await repository.findContactById(tenantId, contactId) : null;
    return contact ? leadDisplayName(contact) : "a contact";
  };
  const bookingRows = bookings.map((b) => ({ ...b, leadName: leadById.get(b.leadId) ? leadDisplayName(leadById.get(b.leadId)!) : "Lead" }));
  const requestRows = await Promise.all(requests.map(async (r) => ({ ...r, who: await contactName(r.contactId, r.leadId) })));
  return <OperationsPanels tenantId={tenantId} fmt={fmt} bookings={bookingRows} requests={requestRows} reviews={reviews} leads={leads} />;
}

async function ContentTab({ tenantId, fmt }: { tenantId: string; fmt: Fmt }) {
  const [workbench, snapshots, inbox] = await Promise.all([
    repository.getWorkbench(tenantId),
    repository.listChannelMetrics(tenantId, { since: new Date(Date.now() - 14 * 86_400_000) }),
    repository.listInboxConversations(tenantId, { limit: 40 }),
  ]);
  const inboxThreads = await Promise.all(inbox.map(async (conversation) => ({ conversation, messages: await repository.listMessages(tenantId, conversation.id, 10) })));
  const draftCounts: Record<string, number> = {};
  for (const a of workbench.assets) if (a.parentId) draftCounts[a.parentId] = (draftCounts[a.parentId] ?? 0) + 1;
  return <ContentStudio tenantId={tenantId} fmt={fmt} sources={workbench.sources} drafts={workbench.assets} posts={workbench.posts} channels={summarizeChannels(workbench.channels, snapshots)} inbox={inboxThreads} draftCounts={draftCounts} />;
}

async function MoneyTab({ tenant, fmt, integrations }: { tenant: TenantSummary; fmt: Fmt; integrations: IntegrationRecord[] }) {
  const [adAccounts, pacing, invoices, links] = await Promise.all([repository.listAdAccounts(tenant.id), pacingStatus(tenant), repository.listInvoices(tenant.id, { limit: 50 }), repository.listTrackedLinks(tenant.id, 30)]);
  const financeIntegrations = integrations.filter((i) => ["SQUARE", "STRIPE", "XERO", "QUICKBOOKS"].includes(i.provider));
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  // The studio renders accounts without their settings (credentials live there).
  const accountsForClient = adAccounts.map((account) => {
    const { settings, ...rest } = account;
    void settings;
    return rest;
  });
  return <MoneyStudio tenantId={tenant.id} tenantSlug={tenant.slug} fmt={fmt} adAccounts={accountsForClient} pacing={pacing} financeIntegrations={financeIntegrations} invoices={invoices} links={links} appUrl={appUrl} />;
}
