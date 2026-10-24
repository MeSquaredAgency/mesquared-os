import { repository } from "@/lib/data";
import type { AdPlatform, AttributionRow, LeadRecord, TenantSummary } from "@/lib/types";

/**
 * Ties spend to leads and revenue. Leads carry the UTMs they arrived with
 * (source/medium/campaign, stamped at intake and by tracked links); ad spend
 * carries platform and campaign name. Rows are keyed by source + campaign;
 * spend joins on campaign name when the UTM campaign matches, otherwise it
 * rolls up to the platform's source. Revenue is completed transactions tied
 * to the lead or its contact inside the window.
 */

const PLATFORM_SOURCES: Record<AdPlatform, string[]> = {
  META: ["facebook", "instagram", "meta", "fb", "ig"],
  GOOGLE_ADS: ["google", "google_ads", "googleads", "adwords", "cpc"],
};

const norm = (s: unknown): string => (typeof s === "string" ? s.trim().toLowerCase() : "");

function sourceOf(lead: LeadRecord): string {
  const a = lead.attribution ?? {};
  const source = norm(a.source);
  if (source) return source;
  const medium = norm(a.medium);
  if (medium === "cpc" || medium === "paid") return "paid";
  return lead.source ? lead.source.toLowerCase().replace(/_/g, " ") : "direct";
}

export interface AttributionReport {
  from: Date;
  to: Date;
  rows: AttributionRow[];
  totals: AttributionRow;
  /** Leads with no source at all. */
  unattributed: number;
}

export async function buildAttributionReport(tenant: TenantSummary, from: Date, to = new Date()): Promise<AttributionReport> {
  const [leads, spend, transactions] = await Promise.all([repository.listLeadsBetween(tenant.id, from, to), repository.listAdSpend(tenant.id, { from, to }), repository.listTransactions(tenant.id, { from, to, status: ["COMPLETED"], kinds: ["PAYMENT", "CONSULTATION_FEE", "RETAINER_DEPOSIT", "INVOICE"], limit: 5000 })]);

  const revenueByLead = new Map<string, number>();
  const revenueByContact = new Map<string, number>();
  for (const t of transactions) {
    if (t.leadId) revenueByLead.set(t.leadId, (revenueByLead.get(t.leadId) ?? 0) + t.amountCents);
    else if (t.contactId) revenueByContact.set(t.contactId, (revenueByContact.get(t.contactId) ?? 0) + t.amountCents);
  }

  const rows = new Map<string, AttributionRow>();
  const row = (source: string, campaign: string | null): AttributionRow => {
    const key = `${source}|${campaign ?? ""}`;
    let r = rows.get(key);
    if (!r) {
      r = { key, source, campaign, spendCents: 0, leads: 0, booked: 0, won: 0, revenueCents: 0, costPerLeadCents: null, costPerAcquisitionCents: null, roas: null };
      rows.set(key, r);
    }
    return r;
  };

  let unattributed = 0;
  const seenContacts = new Set<string>();
  for (const lead of leads) {
    const source = sourceOf(lead);
    if (source === "direct" && !lead.attribution?.campaign) unattributed++;
    const r = row(source, norm(lead.attribution?.campaign) || null);
    r.leads++;
    if (lead.bookedAt) r.booked++;
    if (lead.status === "WON") r.won++;
    let revenue = revenueByLead.get(lead.id) ?? 0;
    if (lead.contactId && !seenContacts.has(lead.contactId)) {
      seenContacts.add(lead.contactId);
      revenue += revenueByContact.get(lead.contactId) ?? 0;
    }
    r.revenueCents += revenue;
  }

  // Spend: join on campaign name under the platform's sources; otherwise the platform's first source.
  for (const s of spend) {
    const campaign = norm(s.campaignName) || null;
    const sources = PLATFORM_SOURCES[s.platform];
    const match = campaign ? Array.from(rows.values()).find((r) => sources.includes(r.source) && r.campaign === campaign) : null;
    const target = match ?? row(sources[0], campaign);
    target.spendCents += s.spendCents;
  }

  const finish = (r: AttributionRow) => {
    r.costPerLeadCents = r.spendCents > 0 && r.leads > 0 ? Math.round(r.spendCents / r.leads) : null;
    r.costPerAcquisitionCents = r.spendCents > 0 && r.won > 0 ? Math.round(r.spendCents / r.won) : null;
    r.roas = r.spendCents > 0 ? Math.round((r.revenueCents / r.spendCents) * 10) / 10 : null;
    return r;
  };
  const list = Array.from(rows.values()).map(finish).sort((a, b) => b.spendCents - a.spendCents || b.leads - a.leads);
  const totals = finish({
    key: "total",
    source: "all",
    campaign: null,
    spendCents: list.reduce((n, r) => n + r.spendCents, 0),
    leads: list.reduce((n, r) => n + r.leads, 0),
    booked: list.reduce((n, r) => n + r.booked, 0),
    won: list.reduce((n, r) => n + r.won, 0),
    revenueCents: list.reduce((n, r) => n + r.revenueCents, 0),
    costPerLeadCents: null,
    costPerAcquisitionCents: null,
    roas: null,
  });
  return { from, to, rows: list, totals, unattributed };
}
