"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { connectAdAccount, runAdsSync } from "@/lib/ads/sync";
import { generateLinkCode, isValidCode } from "@/lib/attribution/links";
import { getConsoleContext } from "@/lib/auth/access";
import { ForbiddenError } from "@/lib/auth/permissions";
import { repository } from "@/lib/data";
import { emit } from "@/lib/events";
import { connectFinanceProvider, runFinanceSync, runInvoiceReminders } from "@/lib/finance/sync";
import { rollupSite } from "@/lib/website/rollup";
import type { TenantSummary } from "@/lib/types";

export interface ActionResult {
  ok: boolean;
  message: string;
}

async function operatorTenant(tenantId: string): Promise<TenantSummary | null> {
  const { tenants } = await getConsoleContext();
  return tenants.find((t) => t.tenant.id === tenantId)?.tenant ?? null;
}

const refresh = (tenant: TenantSummary) => {
  revalidatePath(`/console/${tenant.slug}`);
  revalidatePath("/console");
  revalidatePath(`/app/${tenant.slug}`);
  revalidatePath(`/app/${tenant.slug}/money`);
};

const fail = (error: unknown): ActionResult => {
  if (error instanceof ForbiddenError) return { ok: false, message: error.message };
  console.error("[money] action failed", error instanceof Error ? error.message : error);
  return { ok: false, message: error instanceof Error && /short code/.test(error.message) ? error.message : "Something went wrong. Please try again." };
};

const adAccountSchema = z.object({
  platform: z.enum(["META", "GOOGLE_ADS"]),
  externalAccountId: z.string().trim().min(3).max(60),
  name: z.string().trim().max(120).optional(),
  monthlyBudget: z.number().min(0).max(10_000_000).optional().nullable(),
  accessToken: z.string().trim().min(8).max(4000),
  refreshToken: z.string().trim().max(4000).optional(),
  developerToken: z.string().trim().max(200).optional(),
  loginCustomerId: z.string().trim().max(40).optional(),
});

/** Connects an ad account from the console; the token is encrypted on the account row and never echoed back. */
export async function connectAdAccountAction(tenantId: string, input: z.input<typeof adAccountSchema>): Promise<ActionResult> {
  try {
    const tenant = await operatorTenant(tenantId);
    if (!tenant) return { ok: false, message: "That workspace isn’t in your portfolio." };
    const parsed = adAccountSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "Platform, account id and an access token are needed." };
    const d = parsed.data;
    await connectAdAccount(tenant, { platform: d.platform, externalAccountId: d.externalAccountId.replace(/-/g, ""), name: d.name || null, monthlyBudgetCents: d.monthlyBudget == null ? null : Math.round(d.monthlyBudget * 100), creds: { accessToken: d.accessToken, refreshToken: d.refreshToken || null, developerToken: d.developerToken || null, loginCustomerId: d.loginCustomerId?.replace(/-/g, "") || null } });
    await repository.recordAutomationRun(tenantId, { typeKey: "ads_sync", outcome: "COMPLETED", summary: `Connected a ${d.platform === "META" ? "Meta" : "Google Ads"} account${d.name ? ` (${d.name})` : ""}.` });
    refresh(tenant);
    return { ok: true, message: "Ad account connected. Spend will be pulled in the next daily sync (or sync now)." };
  } catch (error) {
    return fail(error);
  }
}

export async function setAdBudgetAction(tenantId: string, adAccountId: string, monthlyBudget: number | null): Promise<ActionResult> {
  try {
    const tenant = await operatorTenant(tenantId);
    if (!tenant) return { ok: false, message: "That workspace isn’t in your portfolio." };
    if (monthlyBudget !== null && (!Number.isFinite(monthlyBudget) || monthlyBudget < 0)) return { ok: false, message: "Budget must be a number." };
    await repository.updateAdAccount(tenantId, adAccountId, { monthlyBudgetCents: monthlyBudget === null ? null : Math.round(monthlyBudget * 100) });
    refresh(tenant);
    return { ok: true, message: "Budget saved." };
  } catch (error) {
    return fail(error);
  }
}

export async function syncAdsNowAction(tenantId: string): Promise<ActionResult> {
  try {
    const tenant = await operatorTenant(tenantId);
    if (!tenant) return { ok: false, message: "That workspace isn’t in your portfolio." };
    const r = await runAdsSync(tenant);
    refresh(tenant);
    return { ok: true, message: `Pulled ${r.rows} day-rows from ${r.accounts} account${r.accounts === 1 ? "" : "s"}${r.pacing?.driftPct != null ? `; pacing ${r.pacing.driftPct > 0 ? "+" : ""}${r.pacing.driftPct}% against plan` : ""}.` };
  } catch (error) {
    return fail(error);
  }
}

const financeSchema = z.object({
  provider: z.enum(["SQUARE", "STRIPE", "XERO"]),
  externalAccountId: z.string().trim().min(1).max(120),
  label: z.string().trim().max(120).optional(),
  accessToken: z.string().trim().min(8).max(4000),
  refreshToken: z.string().trim().max(4000).optional(),
  xeroTenantId: z.string().trim().max(80).optional(),
  locationId: z.string().trim().max(80).optional(),
  webhookSecret: z.string().trim().max(400).optional(),
});

export async function connectFinanceAction(tenantId: string, input: z.input<typeof financeSchema>): Promise<ActionResult> {
  try {
    const tenant = await operatorTenant(tenantId);
    if (!tenant) return { ok: false, message: "That workspace isn’t in your portfolio." };
    const parsed = financeSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "Provider, account id and an access token are needed." };
    const d = parsed.data;
    await connectFinanceProvider(tenantId, d.provider, { accessToken: d.accessToken, refreshToken: d.refreshToken || null, xeroTenantId: d.xeroTenantId || null, locationId: d.locationId || null, webhookSecret: d.webhookSecret || null }, { externalAccountId: d.externalAccountId, label: d.label || null });
    await repository.recordAutomationRun(tenantId, { typeKey: "finance_sync", outcome: "COMPLETED", summary: `Connected ${d.provider === "SQUARE" ? "Square" : d.provider === "STRIPE" ? "Stripe" : "Xero"}.` });
    refresh(tenant);
    const integration = await repository.findIntegration(tenantId, d.provider);
    return { ok: true, message: d.provider === "XERO" ? "Xero connected; the daily sync pulls invoices and payments." : `Connected. Webhook URL for ${d.provider === "SQUARE" ? "Square" : "Stripe"}: /api/v1/webhooks/${d.provider.toLowerCase()}/${integration?.id ?? ""}` };
  } catch (error) {
    return fail(error);
  }
}

export async function syncFinanceNowAction(tenantId: string): Promise<ActionResult> {
  try {
    const tenant = await operatorTenant(tenantId);
    if (!tenant) return { ok: false, message: "That workspace isn’t in your portfolio." };
    const r = await runFinanceSync(tenant);
    refresh(tenant);
    return { ok: true, message: `Synced ${r.providers} provider${r.providers === 1 ? "" : "s"}: ${r.transactions} new payments, ${r.invoices} invoice updates; ${r.reminded} reminded, ${r.chased} chased.` };
  } catch (error) {
    return fail(error);
  }
}

export async function runRemindersNowAction(tenantId: string): Promise<ActionResult> {
  try {
    const tenant = await operatorTenant(tenantId);
    if (!tenant) return { ok: false, message: "That workspace isn’t in your portfolio." };
    const r = await runInvoiceReminders(tenant);
    refresh(tenant);
    return { ok: true, message: `${r.reminded} reminded, ${r.chased} chased, ${r.escalated} handed to a person.` };
  } catch (error) {
    return fail(error);
  }
}

/** A payment recorded by hand (cash, bank transfer) so the Money panel and attribution stay honest. */
export async function markInvoicePaidAction(tenantId: string, invoiceId: string): Promise<ActionResult> {
  try {
    const tenant = await operatorTenant(tenantId);
    if (!tenant) return { ok: false, message: "That workspace isn’t in your portfolio." };
    const inv = (await repository.listInvoices(tenantId, { limit: 500 })).find((i) => i.id === invoiceId);
    if (!inv) return { ok: false, message: "That invoice no longer exists." };
    if (inv.status === "PAID") return { ok: false, message: "Already paid." };
    await repository.updateInvoice(tenantId, invoiceId, { status: "PAID", paidAt: new Date() });
    await repository.upsertTransactions(tenantId, [{ provider: "MANUAL", providerId: `invoice:${inv.id}`, kind: "PAYMENT", status: "COMPLETED", amountCents: inv.amountDueCents || inv.amountCents, currency: inv.currency, occurredAt: new Date(), note: `Paid: ${inv.number ?? inv.externalId}`, contactId: inv.contactId, customerEmail: inv.customerEmail }]);
    await repository.recordAutomationRun(tenantId, { typeKey: "finance_sync", outcome: "COMPLETED", summary: `${inv.customerName ?? "A customer"} paid ${inv.number ? `invoice ${inv.number}` : "an invoice"} (recorded by the Me² team).`, contactId: inv.contactId });
    await emit(tenantId, "invoice.paid", { invoiceId: inv.id, amountCents: inv.amountCents, provider: "MANUAL" });
    refresh(tenant);
    return { ok: true, message: "Marked paid and recorded as revenue." };
  } catch (error) {
    return fail(error);
  }
}

const linkSchema = z.object({
  destination: z.string().trim().url().regex(/^https?:\/\//i),
  label: z.string().trim().max(120).optional(),
  code: z.string().trim().max(60).optional(),
  source: z.string().trim().max(60).optional(),
  medium: z.string().trim().max(60).optional(),
  campaign: z.string().trim().max(80).optional(),
  content: z.string().trim().max(80).optional(),
});

export async function createTrackedLinkAction(tenantId: string, input: z.input<typeof linkSchema>): Promise<ActionResult & { code?: string }> {
  try {
    const tenant = await operatorTenant(tenantId);
    if (!tenant) return { ok: false, message: "That workspace isn’t in your portfolio." };
    const parsed = linkSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "A full destination URL (https://…) is needed." };
    const d = parsed.data;
    const code = (d.code?.toLowerCase() || generateLinkCode(tenant.slug)).replace(/[^a-z0-9-]/g, "-");
    if (!isValidCode(code)) return { ok: false, message: "Short codes are letters, numbers and dashes (3–60 characters)." };
    const link = await repository.createTrackedLink(tenantId, { code, destination: d.destination, label: d.label || null, source: d.source?.toLowerCase() || null, medium: d.medium?.toLowerCase() || null, campaign: d.campaign?.toLowerCase() || null, content: d.content?.toLowerCase() || null });
    refresh(tenant);
    return { ok: true, message: `Link ready: /r/${link.code}`, code: link.code };
  } catch (error) {
    return fail(error);
  }
}

export async function rollupSiteNowAction(tenantId: string): Promise<ActionResult> {
  try {
    const tenant = await operatorTenant(tenantId);
    if (!tenant) return { ok: false, message: "That workspace isn’t in your portfolio." };
    await rollupSite(tenant, new Date(Date.now() - 86_400_000));
    await rollupSite(tenant, new Date());
    refresh(tenant);
    return { ok: true, message: "Website numbers updated for yesterday and today." };
  } catch (error) {
    return fail(error);
  }
}
