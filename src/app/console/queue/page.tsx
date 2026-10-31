import { ExceptionQueue } from "@/components/console/exception-queue";
import { PageHeader } from "@/components/shell/section";
import { getConsoleContext } from "@/lib/auth/access";
import { repository } from "@/lib/data";
import { toTenantOption } from "@/lib/types";

export const metadata = { title: "Queue" };

export default async function QueuePage() {
  const { tenants } = await getConsoleContext();
  const items = await repository.listExceptions(tenants.map((t) => t.tenant.id));
  return (
    <div className="flex flex-col gap-8">
      <PageHeader eyebrow="Operator console" title={items.length === 0 ? "The queue is clear" : `${items.length} thing${items.length === 1 ? "" : "s"} for a person`} lede="Everything automation couldn’t finish on its own, across your portfolio. Oldest first." />
      <ExceptionQueue items={items} tenants={tenants.map((t) => toTenantOption(t.tenant))} />
    </div>
  );
}
