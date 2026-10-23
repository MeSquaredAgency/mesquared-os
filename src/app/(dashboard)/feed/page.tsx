import { LeadFeed } from "@/components/dashboard/lead-feed";
import { TransactionStream } from "@/components/dashboard/transaction-stream";
import { repository } from "@/lib/data";
import { getCurrentTenant } from "@/lib/tenant/current";

export const metadata = { title: "Live feed" };

export default async function FeedPage() {
  const { tenant } = await getCurrentTenant();
  const [leads, transactions] = await Promise.all([
    repository.listRecentLeads(tenant.id, 30),
    repository.listRecentTransactions(tenant.id, 30),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Live feed</h1>
        <p className="text-sm text-muted-foreground">Real-time lead intake and the Square payment stream for {tenant.name}.</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <LeadFeed leads={leads} />
        <TransactionStream transactions={transactions} currency={tenant.currency} locale={tenant.locale} />
      </div>
    </div>
  );
}
