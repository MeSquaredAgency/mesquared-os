import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { headers } from "next/headers";
import { clientIpFromHeaders } from "@/lib/auth/client-ip";
import { repository } from "@/lib/data";
import { emit } from "@/lib/events";
import { takeIntakeTokens } from "@/lib/intake/rate-limit";
import { leadDisplayName } from "@/lib/leads";

export const dynamic = "force-dynamic";

/**
 * /book/[tenant]?lead=… — the platform's own booking page, used when a tenant
 * has no Cal.com connected yet. It never dead-ends: with Cal.com connected it
 * forwards there; otherwise it takes a callback request so a person follows up.
 */
export default async function BookPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ lead?: string; done?: string }> }) {
  const { tenant: slug } = await params;
  const { lead: leadId, done } = await searchParams;
  const tenant = await repository.findTenantBySlug(slug);
  if (!tenant) notFound();

  const calcom = await repository.findIntegration(tenant.id, "CALCOM");
  const eventSlug = typeof calcom?.settings.eventTypeSlug === "string" ? calcom.settings.eventTypeSlug : null;
  if (calcom?.status === "CONNECTED" && eventSlug) redirect(`https://cal.com/${eventSlug}`);

  async function requestCallback(formData: FormData) {
    "use server";
    const t = await repository.findTenantBySlug(slug);
    if (!t) return;
    const id = String(formData.get("lead") ?? "");
    const when = String(formData.get("when") ?? "").slice(0, 120);
    const h = await headers();
    const limit = await takeIntakeTokens([`callback:${t.id}`, `callback:ip:${clientIpFromHeaders((n) => h.get(n))}`]);
    if (!limit.allowed) redirect(`/book/${slug}?done=1`);
    const lead = id ? await repository.findLeadById(t.id, id) : null;
    // One open request per lead: resubmitting the form (or a reposted link) must not fill the queue.
    const alreadyAsked = lead ? (await repository.listExceptions([t.id], { status: ["OPEN", "IN_PROGRESS"], limit: 200 })).some((e) => e.leadId === lead.id && /called back/.test(e.reason)) : false;
    if (lead && !alreadyAsked) {
      await repository.touchLead(t.id, lead.id, new Date());
      await repository.recordAutomationRun(t.id, { typeKey: "booking_lifecycle", outcome: "COMPLETED", summary: `${leadDisplayName(lead)} asked for a call back${when ? ` (${when.replace(/[<>]/g, "")})` : ""}.`, leadId: lead.id, contactId: lead.contactId });
      await repository.createException(t.id, { reason: `${leadDisplayName(lead)} asked to be called back${when ? `: "${when.replace(/[<>]/g, "")}"` : ""}.`, suggestedAction: "Call them at the time they suggested.", confidence: 0.9, leadId: lead.id, contactId: lead.contactId });
      await emit(t.id, "booking.callback_requested", { leadId: lead.id });
    }
    redirect(`/book/${slug}?done=1`);
  }

  // The customer's page carries the business's name, never Me²'s.
  return (
    <main data-theme="paper" className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <div className="surface flex w-full max-w-md flex-col gap-6 p-6 shadow-card sm:p-8">
        <div className="flex flex-col gap-2">
          <p className="eyebrow">{tenant.branding.fromName ?? tenant.name}</p>
          <h1 className="page-title">{done ? "Thank you" : "Let’s find a time"}</h1>
        </div>
        {done ? (
          <p className="lede">We’ve let the team know. Someone will call you back shortly.</p>
        ) : (
          <form action={requestCallback} className="flex flex-col gap-5">
            <input type="hidden" name="lead" value={leadId ?? ""} />
            <Field label="When suits you best for a call?">
              <Input name="when" placeholder="e.g. tomorrow morning, or any afternoon this week" maxLength={120} className="h-11 text-base" />
            </Field>
            <Button type="submit" size="lg">
              Ask for a call back
            </Button>
            <p className="text-xs text-muted-foreground">You’ll hear from {tenant.name} directly. Reply to any message from us if you’d rather not be contacted.</p>
          </form>
        )}
      </div>
    </main>
  );
}
