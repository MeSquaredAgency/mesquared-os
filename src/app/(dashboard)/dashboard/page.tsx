import { CalendarCheck, DollarSign, Inbox, ListChecks } from "lucide-react";
import { StatCard } from "@/components/dashboard/stat-card";
import { TicketBoard } from "@/components/dashboard/ticket-board";
import { repository } from "@/lib/data";
import { getCurrentTenant } from "@/lib/tenant/current";
import { formatMoney } from "@/lib/utils";

export const metadata = { title: "Tickets" };

export default async function DashboardPage() {
  const { tenant } = await getCurrentTenant();
  const board = await repository.getTicketBoard(tenant.id, { timezone: tenant.timezone, currency: tenant.currency });
  const { stats } = board;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Today at {tenant.name}</h1>
        <p className="text-sm text-muted-foreground">Green tickets drive revenue. Red tickets get automated.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Green open" value={stats.greenOpen} hint={`${stats.greenLeadsToday} new green leads today`} tone="green" icon={<ListChecks className="size-4" />} />
        <StatCard label="Red open" value={stats.redOpen} hint={`${stats.redLeadsToday} routed to the admin queue today`} tone="red" icon={<Inbox className="size-4" />} />
        <StatCard label="Booking links out" value={stats.bookingsPending} hint="Awaiting a time slot" icon={<CalendarCheck className="size-4" />} />
        <StatCard label="Revenue today" value={formatMoney(stats.revenueTodayCents, tenant.currency, tenant.locale)} hint="Completed Square payments" icon={<DollarSign className="size-4" />} />
      </div>

      <TicketBoard board={board} fmt={tenant} />
    </div>
  );
}
