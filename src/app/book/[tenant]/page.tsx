import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { clientIpFromHeaders } from "@/lib/auth/client-ip";
import { repository } from "@/lib/data";
import { processIntake } from "@/lib/intake/process";
import { takeIntakeTokens } from "@/lib/intake/rate-limit";
import { intakeSchema } from "@/lib/intake/schema";
import { safeName } from "@/lib/messaging/templates";
import { bookingLinkFor } from "@/lib/scheduling/calcom";
import { cleanWhen, recordCallbackRequest } from "@/lib/scheduling/callback";

export const dynamic = "force-dynamic";

/**
 * /book/[tenant]?lead=… — the platform's own booking page, used when a tenant
 * has no Cal.com connected. It never dead-ends: with Cal.com connected it
 * forwards there; otherwise it takes a callback request so a person follows
 * up. A link with no lead on it (shared on, or mangled) asks for a name and
 * number and brings them in as a new enquiry instead of thanking nobody.
 */
export default async function BookPage({ params, searchParams }: { params: Promise<{ tenant: string }>; searchParams: Promise<{ lead?: string; done?: string; error?: string }> }) {
  const { tenant: slug } = await params;
  const { lead: leadId, done, error } = await searchParams;
  const tenant = await repository.findTenantBySlug(slug);
  if (!tenant) notFound();

  const lead = leadId ? await repository.findLeadById(tenant.id, leadId) : null;
  // With Cal.com connected the booking link is theirs, prefilled with what we know; this page only exists when it is not.
  const calcom = await repository.findIntegration(tenant.id, "CALCOM");
  const eventSlug = typeof calcom?.settings.eventTypeSlug === "string" ? calcom.settings.eventTypeSlug : null;
  if (calcom?.status === "CONNECTED" && eventSlug) redirect(await bookingLinkFor(tenant, lead ?? { id: leadId ?? "", firstName: null, lastName: null, email: null, phone: null }));
  const firstName = lead ? safeName(lead.firstName) : null;
  // Who will ring them: the assigned person when the business signs as them, otherwise the business.
  const caller = lead?.assigneeId && tenant.branding.signAsAssignee ? ((await repository.listTenantPeople(tenant.id)).find((p) => p.userId === lead.assigneeId)?.name?.trim().split(/\s+/)[0] ?? null) : null;

  async function requestCallback(formData: FormData) {
    "use server";
    const t = await repository.findTenantBySlug(slug);
    if (!t) return;
    const id = String(formData.get("lead") ?? "");
    const when = cleanWhen(String(formData.get("when") ?? ""));
    const h = await headers();
    const limit = await takeIntakeTokens([`callback:${t.id}`, `callback:ip:${clientIpFromHeaders((n) => h.get(n))}`]);
    if (!limit.allowed) redirect(`/book/${slug}?done=1`);
    const known = id ? await repository.findLeadById(t.id, id) : null;
    if (known) {
      await recordCallbackRequest(t, known, when);
      redirect(`/book/${slug}?done=1&lead=${encodeURIComponent(known.id)}`);
    }
    // Nobody we know: take their details through intake, so they are qualified, acknowledged and alerted like any
    // enquiry, then log the call-back on the lead that made (the alert already carries their words, so no second text).
    const parsed = intakeSchema.safeParse({
      source: "WEB_FORM",
      name: String(formData.get("name") ?? "").slice(0, 120),
      phone: String(formData.get("phone") ?? "").slice(0, 40) || null,
      email: String(formData.get("email") ?? "").slice(0, 320) || null,
      message: `Asked for a call back${when ? `: ${when}` : ""}.`,
    });
    if (!parsed.success) redirect(`/book/${slug}?error=1`);
    const result = await processIntake(t, parsed.data, { name: parsed.data.name, phone: parsed.data.phone, email: parsed.data.email, when }, { channel: "WEB_FORM", provider: "booking-page" });
    if (result.outcome === "created" || result.outcome === "duplicate") {
      await recordCallbackRequest(t, result.lead, when, { notify: result.outcome === "duplicate" });
      redirect(`/book/${slug}?done=1&lead=${encodeURIComponent(result.lead.id)}`);
    }
    redirect(`/book/${slug}?done=1`);
  }

  // The customer's page carries the business's name, never Me²'s.
  return (
    <main data-theme="paper" className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <div className="surface flex w-full max-w-md flex-col gap-6 p-6 shadow-card sm:p-8">
        <div className="flex flex-col gap-2">
          <p className="eyebrow">{tenant.branding.fromName ?? tenant.name}</p>
          <h1 className="page-title">{done ? (firstName ? `Thank you, ${firstName}` : "Thank you") : firstName ? `${firstName}, let’s find a time` : "Let’s find a time"}</h1>
        </div>
        {done ? (
          <p className="lede">{caller ? `${caller} has been told and will call you back shortly.` : `We’ve let ${tenant.name} know. Someone will call you back shortly.`}</p>
        ) : (
          <form action={requestCallback} className="flex flex-col gap-5">
            <input type="hidden" name="lead" value={lead?.id ?? ""} />
            {!lead && (
              <>
                <Field label="Your name">
                  <Input name="name" autoComplete="name" maxLength={120} className="h-11 text-base" />
                </Field>
                <Field label="Best number to call" hint={error ? "Please check the number; it should have at least six digits." : undefined}>
                  <Input name="phone" type="tel" autoComplete="tel" inputMode="tel" required maxLength={40} className="h-11 text-base" aria-invalid={error ? true : undefined} />
                </Field>
                <Field label="Email (optional)">
                  <Input name="email" type="email" autoComplete="email" maxLength={320} className="h-11 text-base" />
                </Field>
              </>
            )}
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
