import { notFound } from "next/navigation";
import { AttributionCard, InvoicesCard, MoneyHeadline, WebsiteCard } from "@/components/portal/money-details";
import { PageHeader } from "@/components/shell/section";
import { pacingStatus } from "@/lib/ads/sync";
import { buildAttributionReport } from "@/lib/attribution/report";
import { getPortalContext } from "@/lib/auth/access";
import { hasPermission } from "@/lib/auth/permissions";
import { repository } from "@/lib/data";
import { summarizeSite } from "@/lib/website/rollup";

export const metadata = { title: "Money" };

/** The client's money page: only for members who may see finances. */
export default async function MoneyPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { access } = await getPortalContext(slug);
  if (!hasPermission(access, "VIEW_FINANCES")) notFound();
  const tenant = access.tenant;
  const fmt = { timezone: tenant.timezone, locale: tenant.locale, currency: tenant.currency };
  const now = new Date();
  const [home, pacing, invoices, report, site] = await Promise.all([
    repository.getPortalHome(tenant.id, { timezone: tenant.timezone, currency: tenant.currency, onlyAssigneeId: null, canViewFinances: true }),
    pacingStatus(tenant, now),
    repository.listInvoices(tenant.id, { limit: 50 }),
    buildAttributionReport(tenant, new Date(now.getTime() - 30 * 86_400_000), now),
    repository.listSiteMetrics(tenant.id, new Date(now.getTime() - 14 * 86_400_000)),
  ]);
  const month = now.toLocaleDateString(tenant.locale, { timeZone: tenant.timezone, month: "long" });

  return (
    <div className="flex flex-col gap-12">
      <PageHeader kicker="Money" title={`${month} so far`} lede={`What came in, what it cost to get, and what is still owed to ${tenant.name}.`} />
      {home.money && <MoneyHeadline money={home.money} pacing={pacing} fmt={fmt} />}
      <AttributionCard report={report} fmt={fmt} />
      <div className="grid gap-12 xl:grid-cols-2 xl:gap-8">
        <InvoicesCard invoices={invoices.sort((a, b) => (a.status === "OVERDUE" ? -1 : 0) - (b.status === "OVERDUE" ? -1 : 0))} fmt={fmt} />
        <WebsiteCard site={summarizeSite(site, now)} fmt={fmt} />
      </div>
    </div>
  );
}
