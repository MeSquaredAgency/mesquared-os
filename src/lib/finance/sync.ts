import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { repository } from "@/lib/data";
import { emit } from "@/lib/events";
import { channelFor, sendMessage, templates } from "@/lib/messaging";
import type { ConnectedFinanceProvider, FinanceProvider, InvoiceRecord, TenantSummary } from "@/lib/types";
import { financeConnectorFor, hasRealFinanceConnector, type FinanceCredentials, type ProviderInvoice, type ProviderTransaction } from "./providers";
import { registerBuiltInFinanceConnectors } from "./providers/builtin";

registerBuiltInFinanceConnectors();

/**
 * Finance: read-only connectors (Square, Stripe, Xero) feed transactions and
 * invoices; the Money panel reads from the rows, never from the provider.
 * Invoice reminders are the one thing that sends: before the due date, then
 * chased while overdue, then handed to a person.
 */

export const FINANCE_PROVIDERS: ConnectedFinanceProvider[] = ["SQUARE", "STRIPE", "XERO", "QUICKBOOKS"];

export async function loadFinanceCredentials(tenantId: string, provider: ConnectedFinanceProvider): Promise<{ integrationId: string; creds: FinanceCredentials } | null> {
  const integration = await repository.findIntegration(tenantId, provider);
  if (!integration?.credentialsEnc) return null;
  try {
    return { integrationId: integration.id, creds: JSON.parse(decryptSecret(integration.credentialsEnc, integration.id)) as FinanceCredentials };
  } catch (error) {
    console.error(`[finance] could not read ${provider} credentials: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

export async function connectFinanceProvider(tenantId: string, provider: ConnectedFinanceProvider, creds: FinanceCredentials, opts: { externalAccountId: string; label?: string | null }) {
  const existing = await repository.findIntegration(tenantId, provider);
  const row = existing ?? (await repository.upsertIntegration(tenantId, { provider, externalAccountId: opts.externalAccountId, label: opts.label ?? null, status: "PENDING" }));
  await repository.upsertIntegration(tenantId, { provider, externalAccountId: opts.externalAccountId, label: opts.label ?? null, status: "CONNECTED", credentialsEnc: encryptSecret(JSON.stringify(creds), row.id), lastError: null });
}

/** Writes provider rows into the tenant's ledger. Shared by the daily sync and the webhooks. */
export async function ingestFinanceRows(tenant: TenantSummary, provider: FinanceProvider, rows: { transactions: ProviderTransaction[]; invoices: ProviderInvoice[] }): Promise<{ transactions: number; invoices: number; paidNow: InvoiceRecord[] }> {
  const transactions = await repository.upsertTransactions(
    tenant.id,
    // A refund keeps its own row next to the original payment, so revenue nets to zero instead of going negative.
    rows.transactions.map((t) => ({ provider, providerId: t.kind === "REFUND" && !t.externalId.endsWith(":refund") ? `${t.externalId}:refund` : t.externalId, kind: t.kind, status: t.status, amountCents: t.amountCents, currency: t.currency, occurredAt: t.occurredAt, note: t.note, customerEmail: t.customerEmail })),
  );
  const { written, paidNow } = await repository.upsertInvoices(
    tenant.id,
    rows.invoices.map((i) => ({ provider, externalId: i.externalId, number: i.number, amountCents: i.amountCents, amountDueCents: i.amountDueCents, currency: i.currency, status: i.status, issuedAt: i.issuedAt, dueAt: i.dueAt, paidAt: i.paidAt, url: i.url, customerName: i.customerName, customerEmail: i.customerEmail })),
  );
  for (const inv of paidNow) await emit(tenant.id, "invoice.paid", { invoiceId: inv.id, amountCents: inv.amountCents, provider, contactId: inv.contactId });
  return { transactions, invoices: written, paidNow };
}

export async function syncFinance(tenant: TenantSummary, now = new Date()): Promise<{ providers: number; transactions: number; invoices: number }> {
  const result = { providers: 0, transactions: 0, invoices: 0 };
  const cfg = await repository.getTenantConfig(tenant.id);
  for (const integration of cfg.integrations.filter((i) => (FINANCE_PROVIDERS as string[]).includes(i.provider) && i.status !== "DISCONNECTED")) {
    const provider = integration.provider as ConnectedFinanceProvider;
    const connector = financeConnectorFor(provider);
    const real = hasRealFinanceConnector(provider);
    const loaded = real ? await loadFinanceCredentials(tenant.id, provider) : null;
    if (real && !loaded) continue;
    let creds = loaded?.creds ?? { accessToken: "" };
    if (real && connector.refreshCredentials && creds.expiresAt && new Date(creds.expiresAt).getTime() < now.getTime() + 5 * 60_000) {
      const fresh = await connector.refreshCredentials(creds).catch(() => null);
      if (fresh && loaded) {
        creds = fresh;
        await repository.upsertIntegration(tenant.id, { provider, externalAccountId: integration.externalAccountId ?? "", status: "CONNECTED", credentialsEnc: encryptSecret(JSON.stringify(fresh), loaded.integrationId) });
      }
    }
    const since = new Date(Math.max((integration.lastSyncAt?.getTime() ?? 0) - 86_400_000, now.getTime() - 90 * 86_400_000));
    const tx = await connector.fetchTransactions(creds, since);
    const inv = connector.fetchInvoices ? await connector.fetchInvoices(creds, since) : { ok: true as const, data: [] };
    if (!tx.ok || !inv.ok) {
      const error = (!tx.ok ? tx.error : null) ?? (!inv.ok ? inv.error : null) ?? "sync failed";
      await repository.upsertIntegration(tenant.id, { provider, externalAccountId: integration.externalAccountId ?? "", status: /401|403|token|expired/i.test(error) ? "NEEDS_ATTENTION" : "CONNECTED", lastError: error });
      continue;
    }
    const ingested = await ingestFinanceRows(tenant, provider, { transactions: tx.data, invoices: inv.data });
    result.providers++;
    result.transactions += ingested.transactions;
    result.invoices += ingested.invoices;
    await repository.upsertIntegration(tenant.id, { provider, externalAccountId: integration.externalAccountId ?? "", status: "CONNECTED", lastError: null, lastSyncAt: now });
  }
  await markOverdue(tenant, now);
  if (result.transactions || result.invoices) await repository.recordAutomationRun(tenant.id, { typeKey: "finance_sync", outcome: "COMPLETED", summary: `Picked up ${result.transactions} new payment${result.transactions === 1 ? "" : "s"} and ${result.invoices} invoice update${result.invoices === 1 ? "" : "s"}.` });
  return result;
}

/** SENT invoices past their due date become OVERDUE (and fire invoice.overdue once). */
export async function markOverdue(tenant: TenantSummary, now = new Date()): Promise<number> {
  const due = await repository.listInvoices(tenant.id, { status: ["SENT"], dueBefore: now });
  for (const inv of due) {
    await repository.updateInvoice(tenant.id, inv.id, { status: "OVERDUE" });
    await emit(tenant.id, "invoice.overdue", { invoiceId: inv.id, amountDueCents: inv.amountDueCents });
  }
  return due.length;
}

const money = (tenant: TenantSummary, cents: number, currency: string) => (cents / 100).toLocaleString(tenant.locale, { style: "currency", currency });

/**
 * The payment_reminders automation: a reminder a few days before the due
 * date, then a chase every N days while overdue, then an exception for a
 * person. Reminders are transactional (the person owes the money) and go to
 * the invoice's email; a known contact's preferred channel is used instead.
 */
export async function runInvoiceReminders(tenant: TenantSummary, now = new Date()): Promise<{ reminded: number; chased: number; escalated: number }> {
  const out = { reminded: 0, chased: 0, escalated: 0 };
  const cfg = await repository.getTenantConfig(tenant.id);
  const automation = cfg.automations.find((a) => a.typeKey === "payment_reminders");
  if (!automation?.enabled) return out;
  const s = automation.settings;
  const remindDaysBefore = typeof s.remindDaysBefore === "number" ? s.remindDaysBefore : 3;
  const chaseEveryDays = typeof s.chaseEveryDays === "number" ? s.chaseEveryDays : 7;
  const maxChases = typeof s.maxChases === "number" ? s.maxChases : 3;

  const invoices = await repository.listInvoices(tenant.id, { status: ["SENT", "OVERDUE"], limit: 500 });
  for (const inv of invoices) {
    if (!inv.dueAt || inv.amountDueCents <= 0) continue;
    const contact = inv.contactId ? await repository.findContactById(tenant.id, inv.contactId) : null;
    const who = contact ? { email: contact.email ?? inv.customerEmail, phone: contact.phone, firstName: contact.firstName } : { email: inv.customerEmail, phone: null, firstName: null };
    const channel = channelFor(tenant, who) ?? (who.email ? "EMAIL" : null);
    const label = inv.customerName ?? who.email ?? "a customer";
    const amount = money(tenant, inv.amountDueCents, inv.currency);
    const dueDays = Math.round((inv.dueAt.getTime() - now.getTime()) / 86_400_000);

    if (inv.status === "SENT") {
      if (inv.remindersSent > 0 || dueDays > remindDaysBefore || dueDays < 0) continue;
      if (!channel) {
        await repository.recordAutomationRun(tenant.id, { typeKey: "payment_reminders", outcome: "SKIPPED", summary: `Couldn't remind ${label} about ${inv.number ? `invoice ${inv.number}` : "their invoice"}: no email or phone on it.` });
        await repository.updateInvoice(tenant.id, inv.id, { remindersSent: 1, lastReminderAt: now });
        continue;
      }
      const msg = templates.invoiceReminder({ tenant, firstName: who.firstName, channel, number: inv.number, amount, dueText: dueDays === 0 ? "today" : dueDays === 1 ? "tomorrow" : `in ${dueDays} days`, url: inv.url, overdue: false });
      await repository.updateInvoice(tenant.id, inv.id, { remindersSent: 1, lastReminderAt: now });
      const run = await repository.recordAutomationRun(tenant.id, { typeKey: "payment_reminders", outcome: "SENT", summary: `Reminded ${label} that ${inv.number ? `invoice ${inv.number}` : "their invoice"} (${amount}) is due ${dueDays === 0 ? "today" : `in ${dueDays} day${dueDays === 1 ? "" : "s"}`}.`, contactId: inv.contactId });
      const r = await sendMessage({ tenant, contactId: inv.contactId, channel, to: channel === "EMAIL" ? who.email! : who.phone!, body: msg.body, subject: msg.subject, automationRunId: run.id, transactional: true });
      if (!r.ok) await repository.updateAutomationRun(tenant.id, run.id, { outcome: r.simulated ? "SKIPPED" : "FAILED", summary: `Couldn't remind ${label} about their invoice: ${r.error}` });
      else out.reminded++;
      continue;
    }

    // OVERDUE
    const sinceLast = inv.lastReminderAt ? (now.getTime() - inv.lastReminderAt.getTime()) / 86_400_000 : Infinity;
    if (sinceLast < chaseEveryDays) continue;
    const chasesSoFar = Math.max(0, inv.remindersSent - 1);
    if (chasesSoFar >= maxChases) {
      if (inv.remindersSent >= maxChases + 2) continue; // already escalated
      await repository.updateInvoice(tenant.id, inv.id, { remindersSent: maxChases + 2, lastReminderAt: now });
      await repository.createException(tenant.id, { reason: `${label} still hasn't paid ${inv.number ? `invoice ${inv.number}` : "an invoice"} for ${amount}, ${Math.abs(dueDays)} days overdue, after ${maxChases} reminders.`, suggestedAction: "Call them, or agree a payment plan with the client.", confidence: 0.8, contactId: inv.contactId });
      await repository.recordAutomationRun(tenant.id, { typeKey: "payment_reminders", outcome: "ESCALATED", summary: `Stopped chasing ${label} for ${inv.number ? `invoice ${inv.number}` : "their invoice"} after ${maxChases} reminders; we've asked a person to call them.`, contactId: inv.contactId });
      out.escalated++;
      continue;
    }
    if (!channel) continue;
    const msg = templates.invoiceReminder({ tenant, firstName: who.firstName, channel, number: inv.number, amount, dueText: `${Math.abs(dueDays)} day${Math.abs(dueDays) === 1 ? "" : "s"} ago`, url: inv.url, overdue: true });
    await repository.updateInvoice(tenant.id, inv.id, { remindersSent: inv.remindersSent + 1, lastReminderAt: now });
    const run = await repository.recordAutomationRun(tenant.id, { typeKey: "payment_reminders", outcome: "SENT", summary: `Chased ${label} for ${inv.number ? `invoice ${inv.number}` : "their invoice"} (${amount}, ${Math.abs(dueDays)} days overdue), reminder ${chasesSoFar + 1} of ${maxChases}.`, contactId: inv.contactId });
    const r = await sendMessage({ tenant, contactId: inv.contactId, channel, to: channel === "EMAIL" ? who.email! : who.phone!, body: msg.body, subject: msg.subject, automationRunId: run.id, transactional: true });
    if (!r.ok) await repository.updateAutomationRun(tenant.id, run.id, { outcome: r.simulated ? "SKIPPED" : "FAILED", summary: `Couldn't chase ${label} for their invoice: ${r.error}` });
    else out.chased++;
  }
  return out;
}

/** The daily job: sync, mark overdue, remind. */
export async function runFinanceSync(tenant: TenantSummary, now = new Date()) {
  const cfg = await repository.getTenantConfig(tenant.id);
  const enabled = cfg.automations.find((a) => a.typeKey === "finance_sync")?.enabled !== false;
  const sync = enabled ? await syncFinance(tenant, now) : { providers: 0, transactions: 0, invoices: 0 };
  const reminders = await runInvoiceReminders(tenant, now);
  return { ...sync, ...reminders };
}
