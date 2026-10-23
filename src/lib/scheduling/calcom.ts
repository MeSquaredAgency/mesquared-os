import { repository } from "@/lib/data";
import type { LeadRecord, TenantSummary } from "@/lib/types";

/**
 * Booking links. With a Cal.com integration the link is the tenant's event
 * type with the lead prefilled; otherwise the platform's own booking page
 * for the tenant (built in a later phase) so the flow never dead-ends.
 */
export async function bookingLinkFor(tenant: TenantSummary, lead: Pick<LeadRecord, "id" | "firstName" | "lastName" | "email" | "phone">): Promise<string> {
  const calcom = await repository.findIntegration(tenant.id, "CALCOM");
  const slug = typeof calcom?.settings.eventTypeSlug === "string" ? calcom.settings.eventTypeSlug : null;
  if (calcom && calcom.status === "CONNECTED" && slug) {
    const base = (typeof calcom.settings.baseUrl === "string" ? calcom.settings.baseUrl : "https://cal.com").replace(/\/$/, "");
    const url = new URL(`${base}/${slug}`);
    const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ");
    if (name) url.searchParams.set("name", name);
    if (lead.email) url.searchParams.set("email", lead.email);
    if (lead.phone) url.searchParams.set("attendeePhoneNumber", lead.phone);
    url.searchParams.set("metadata[leadId]", lead.id);
    url.searchParams.set("metadata[tenant]", tenant.slug);
    return url.toString();
  }
  return platformBookingUrl(tenant, lead.id);
}

export function platformBookingUrl(tenant: TenantSummary, leadId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base) {
    if (process.env.NODE_ENV === "production") throw new Error("NEXT_PUBLIC_APP_URL must be set in production to build booking links.");
    return `http://localhost:3000/book/${tenant.slug}?lead=${leadId}`;
  }
  return `${base.replace(/\/$/, "")}/book/${tenant.slug}?lead=${leadId}`;
}
