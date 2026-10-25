import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsStudio } from "@/components/console/settings-studio";
import { getConsoleContext } from "@/lib/auth/access";
import { repository } from "@/lib/data";
import { platformReadiness, tenantReadiness } from "@/lib/launch/readiness";

export const metadata = { title: "Workspace settings" };

export default async function TenantSettingsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { tenants, user } = await getConsoleContext();
  const access = tenants.find((t) => t.tenant.slug === slug);
  if (!access) notFound();
  const tenant = access.tenant;
  const [config, people, operators, keys, inventory, readiness] = await Promise.all([repository.getTenantConfig(tenant.id), repository.listTenantPeople(tenant.id), repository.listOperators(), repository.listApiKeys(tenant.id), repository.listInventory(tenant.id, { limit: 100 }), tenantReadiness(tenant)]);
  const fmt = { timezone: tenant.timezone, locale: tenant.locale, currency: tenant.currency };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{tenant.name}: settings</h1>
          <p className="text-sm text-muted-foreground">Everything about this client is configuration here, never code. Changes apply straight away.</p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/console/${tenant.slug}`}>
            <ArrowLeft /> Back to workspace
          </Link>
        </Button>
      </div>
      <SettingsStudio
        tenant={tenant}
        isAdmin={user.isPlatformAdmin}
        fmt={fmt}
        readiness={readiness}
        platformReadiness={platformReadiness(process.env, { lastTickAt: await repository.getHeartbeat("tick").catch(() => null) })}
        brand={{ voice: config.brand?.voice ?? null, bannedPhrases: config.brand?.bannedPhrases ?? [], requiredFooter: config.brand?.complianceBlock.requiredFooter ?? "", claimsPolicy: config.brand?.complianceBlock.claimsPolicy ?? "" }}
        roles={config.roles}
        people={people}
        operators={operators}
        keys={keys}
        modules={config.modules}
        automations={config.automations}
        inventory={inventory}
      />
    </div>
  );
}
