import { Workbench } from "@/components/dashboard/workbench";
import { repository } from "@/lib/data";
import { atLeast } from "@/lib/auth/roles";
import { getCurrentTenant } from "@/lib/tenant/current";

export const metadata = { title: "Marketing" };

export default async function MarketingPage() {
  const { tenant } = await getCurrentTenant();
  const workbench = await repository.getWorkbench(tenant.id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Marketing workbench</h1>
        <p className="text-sm text-muted-foreground">Create once for Facebook, Instagram, TikTok, YouTube and LinkedIn. Approve before anything goes live.</p>
      </div>
      <Workbench
        key={tenant.id}
        data={workbench}
        tenantName={tenant.name}
        fmt={{ timezone: tenant.timezone, locale: tenant.locale }}
        canDraft={atLeast(tenant.role, "MARKETING")}
        canApprove={atLeast(tenant.role, "OPERATOR")}
      />
    </div>
  );
}
