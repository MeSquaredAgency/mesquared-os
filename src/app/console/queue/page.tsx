import { ExceptionQueue } from "@/components/console/exception-queue";
import { getConsoleContext } from "@/lib/auth/access";
import { repository } from "@/lib/data";
import { toTenantOption } from "@/lib/types";

export const metadata = { title: "Queue" };

export default async function QueuePage() {
  const { tenants } = await getConsoleContext();
  const items = await repository.listExceptions(tenants.map((t) => t.tenant.id));
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Exception queue</h1>
        <p className="text-sm text-muted-foreground">Everything automation couldn’t finish on its own, across your portfolio.</p>
      </div>
      <ExceptionQueue items={items} tenants={tenants.map((t) => toTenantOption(t.tenant))} />
    </div>
  );
}
