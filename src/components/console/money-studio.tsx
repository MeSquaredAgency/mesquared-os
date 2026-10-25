"use client";

import { useState, useTransition } from "react";
import { Check, Link2, RefreshCw, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel, Section } from "@/components/shell/section";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/shell/status-badge";
import type { PacingStatus } from "@/lib/ads/sync";
import { connectAdAccountAction, connectFinanceAction, createTrackedLinkAction, markInvoicePaidAction, rollupSiteNowAction, runRemindersNowAction, setAdBudgetAction, syncAdsNowAction, syncFinanceNowAction } from "@/lib/money/actions";
import type { AdAccountRecord, IntegrationRecord, InvoiceRecord, TrackedLinkRecord } from "@/lib/types";
import { cn, formatDateTime, formatMoney, type FormatContext } from "@/lib/utils";

interface Props {
  tenantId: string;
  tenantSlug: string;
  fmt: FormatContext;
  adAccounts: Omit<AdAccountRecord, "settings">[];
  pacing: PacingStatus | null;
  financeIntegrations: IntegrationRecord[];
  invoices: InvoiceRecord[];
  links: TrackedLinkRecord[];
  appUrl: string;
}

type Run = (fn: () => Promise<{ ok: boolean; message: string }>) => void;

/** Operator controls for ads, finance connections, invoices and tracked links. Every button is a server action scoped to the portfolio. */
export function MoneyStudio({ tenantId, tenantSlug, fmt, adAccounts, pacing, financeIntegrations, invoices, links, appUrl }: Props) {
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const run: Run = (fn) => start(async () => setNotice(await fn().then((r) => ({ tone: r.ok ? "ok" : "error", text: r.message }))));
  const open = invoices.filter((i) => i.status === "SENT" || i.status === "OVERDUE");

  return (
    <div className="flex flex-col gap-3">
      {notice && (
        <p role="status" aria-live="polite" className={cn("rounded-lg px-4 py-3 text-sm", notice.tone === "ok" ? "bg-green-soft text-green-text" : "bg-red-soft text-red-text")}>
          {notice.text}
        </p>
      )}
      <Tabs defaultValue="ads">
        <TabsList className="flex-wrap">
          <TabsTrigger value="ads">
            Ads <Badge variant={pacing && pacing.driftPct !== null && Math.abs(pacing.driftPct) >= 25 ? "red" : "muted"}>{adAccounts.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="finance">
            Invoices <Badge variant={open.some((i) => i.status === "OVERDUE") ? "red" : "muted"}>{open.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="links">Tracked links</TabsTrigger>
        </TabsList>
        <TabsContent value="ads" className="mt-3">
          <AdsPanel tenantId={tenantId} fmt={fmt} adAccounts={adAccounts} pacing={pacing} pending={pending} run={run} />
        </TabsContent>
        <TabsContent value="finance" className="mt-3">
          <FinancePanel tenantId={tenantId} fmt={fmt} integrations={financeIntegrations} invoices={invoices} pending={pending} run={run} appUrl={appUrl} />
        </TabsContent>
        <TabsContent value="links" className="mt-3">
          <LinksPanel tenantId={tenantId} tenantSlug={tenantSlug} links={links} pending={pending} run={run} appUrl={appUrl} fmt={fmt} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AdsPanel({ tenantId, fmt, adAccounts, pacing, pending, run }: { tenantId: string; fmt: FormatContext; adAccounts: Omit<AdAccountRecord, "settings">[]; pacing: PacingStatus | null; pending: boolean; run: Run }) {
  const [form, setForm] = useState({ platform: "META" as "META" | "GOOGLE_ADS", externalAccountId: "", name: "", monthlyBudget: "", accessToken: "", refreshToken: "", developerToken: "", loginCustomerId: "" });
  const [budgets, setBudgets] = useState<Record<string, string>>({});
  const m = (c: number) => formatMoney(c, fmt.currency, fmt.locale);
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section id="ads-accounts-title" level="h3" title="Ad accounts and pacing" lede={<>{pacing ? `${m(pacing.spentCents)} spent of ${m(pacing.budgetCents)} planned by day ${pacing.daysElapsed} of ${pacing.daysInMonth}${pacing.driftPct !== null ? ` (${pacing.driftPct > 0 ? "+" : ""}${pacing.driftPct}% vs plan, heading for ${m(pacing.projectedCents)})` : ""}.` : "Set a monthly budget on each account to get pacing alerts."}</>} action={<><Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => syncAdsNowAction(tenantId))}>
            <RefreshCw /> Sync now
          </Button></>}>
<Panel className="py-5">
          {adAccounts.length === 0 ? (
            <p className="py-4 text-base text-muted-foreground">No ad accounts connected.</p>
          ) : (
            <ul className="divide-y">
              {adAccounts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {a.platform === "META" ? "Meta" : "Google Ads"} <span className="text-muted-foreground">· {a.name ?? a.externalAccountId}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {a.lastSyncAt ? `synced ${formatDateTime(a.lastSyncAt, fmt)}` : "not synced yet"}
                      {a.lastError ? ` · ${a.lastError}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input className="w-36" type="number" min={0} placeholder={a.monthlyBudgetCents != null ? String(a.monthlyBudgetCents / 100) : "Budget / month"} value={budgets[a.id] ?? ""} onChange={(e) => setBudgets({ ...budgets, [a.id]: e.target.value })} aria-label={`Monthly budget for ${a.name ?? a.externalAccountId}`} />
                    <Button size="sm" variant="outline" disabled={pending || budgets[a.id] === undefined || budgets[a.id] === ""} onClick={() => run(() => setAdBudgetAction(tenantId, a.id, Number(budgets[a.id])))}>
                      <Check /> Save
                    </Button>
                    <Badge variant={a.lastError ? "red" : a.isActive ? "green" : "muted"}>{a.lastError ? "Needs attention" : a.isActive ? "Active" : "Off"}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
</Section>
      <Section id="ads-connect-title" level="h3" title="Connect an ad account" lede="Read-only access: spend and results only. Tokens are encrypted and never shown again.">
<Panel className="py-5 flex flex-col gap-2">
          <select className="h-11 rounded-lg border border-input bg-card px-4 text-base" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value as "META" | "GOOGLE_ADS" })} aria-label="Platform">
            <option value="META">Meta (Facebook & Instagram)</option>
            <option value="GOOGLE_ADS">Google Ads</option>
          </select>
          <Input placeholder={form.platform === "META" ? "Ad account id (act_…)" : "Customer id (123-456-7890)"} value={form.externalAccountId} onChange={(e) => setForm({ ...form, externalAccountId: e.target.value })} aria-label="Account id" />
          <Input placeholder="Name (optional)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Account name" />
          <Input type="number" min={0} placeholder={`Monthly budget in ${fmt.currency} (optional)`} value={form.monthlyBudget} onChange={(e) => setForm({ ...form, monthlyBudget: e.target.value })} aria-label="Monthly budget" />
          <Input type="password" placeholder="Access token" value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} aria-label="Access token" autoComplete="off" />
          {form.platform === "GOOGLE_ADS" && (
            <>
              <Input type="password" placeholder="Refresh token" value={form.refreshToken} onChange={(e) => setForm({ ...form, refreshToken: e.target.value })} aria-label="Refresh token" autoComplete="off" />
              <Input type="password" placeholder="Developer token" value={form.developerToken} onChange={(e) => setForm({ ...form, developerToken: e.target.value })} aria-label="Developer token" autoComplete="off" />
              <Input placeholder="Manager (login) customer id, if any" value={form.loginCustomerId} onChange={(e) => setForm({ ...form, loginCustomerId: e.target.value })} aria-label="Login customer id" />
            </>
          )}
          <Button
            disabled={pending || !form.externalAccountId || form.accessToken.length < 8}
            onClick={() =>
              run(async () => {
                const r = await connectAdAccountAction(tenantId, { ...form, name: form.name || undefined, monthlyBudget: form.monthlyBudget ? Number(form.monthlyBudget) : null, refreshToken: form.refreshToken || undefined, developerToken: form.developerToken || undefined, loginCustomerId: form.loginCustomerId || undefined });
                if (r.ok) setForm({ ...form, externalAccountId: "", name: "", monthlyBudget: "", accessToken: "", refreshToken: "", developerToken: "", loginCustomerId: "" });
                return r;
              })
            }
          >
            <Link2 /> Connect
          </Button>
        </Panel>
</Section>
    </div>
  );
}

function FinancePanel({ tenantId, fmt, integrations, invoices, pending, run, appUrl }: { tenantId: string; fmt: FormatContext; integrations: IntegrationRecord[]; invoices: InvoiceRecord[]; pending: boolean; run: Run; appUrl: string }) {
  const [form, setForm] = useState({ provider: "XERO" as "SQUARE" | "STRIPE" | "XERO", externalAccountId: "", label: "", accessToken: "", refreshToken: "", xeroTenantId: "", locationId: "", webhookSecret: "" });
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section id="invoices-ops-title" level="h3" title="Invoices" lede="Reminders go out before the due date and chase while overdue; after the last one a person is asked to call." action={<><div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => syncFinanceNowAction(tenantId))}>
              <RefreshCw /> Sync
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => runRemindersNowAction(tenantId))}>
              <Send /> Run reminders
            </Button>
          </div></>}>
<Panel className="py-5">
          {integrations.length > 0 && (
            <ul className="mb-3 flex flex-wrap gap-2 text-xs">
              {integrations.map((i) => (
                <li key={i.id} className="rounded-lg border px-3 py-2">
                  {i.label ?? i.provider} <Badge variant={i.status === "CONNECTED" ? "green" : "red"} className="ml-1">{i.status === "CONNECTED" ? "Connected" : "Needs attention"}</Badge>
                  {(i.provider === "SQUARE" || i.provider === "STRIPE") && <span className="ml-2 text-muted-foreground">webhook: {appUrl}/api/v1/webhooks/{i.provider.toLowerCase()}/{i.id}</span>}
                </li>
              ))}
            </ul>
          )}
          {invoices.length === 0 ? (
            <p className="py-4 text-base text-muted-foreground">No invoices yet.</p>
          ) : (
            <ul className="divide-y">
              {invoices.slice(0, 15).map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm">
                      {i.number ? `#${i.number}` : "Invoice"} · {i.customerName ?? i.customerEmail ?? "customer"} · {formatMoney(i.status === "PAID" ? i.amountCents : i.amountDueCents, i.currency, fmt.locale)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {i.dueAt ? `due ${formatDateTime(i.dueAt, fmt).replace(/,.*$/, "")}` : "no due date"}
                      {i.remindersSent ? ` · ${i.remindersSent} reminder${i.remindersSent === 1 ? "" : "s"}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={i.status} />
                    {i.status !== "PAID" && i.status !== "VOID" && (
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => markInvoicePaidAction(tenantId, i.id))}>
                        <Check /> Mark paid
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
</Section>
      <Section id="finance-connect-title" level="h3" title="Connect a finance provider" lede="Read-only. Square and Stripe also push payments in real time through their webhook; paste the signing secret for that.">
<Panel className="py-5 flex flex-col gap-2">
          <select className="h-11 rounded-lg border border-input bg-card px-4 text-base" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value as "SQUARE" | "STRIPE" | "XERO" })} aria-label="Provider">
            <option value="XERO">Xero</option>
            <option value="SQUARE">Square</option>
            <option value="STRIPE">Stripe</option>
          </select>
          <Input placeholder={form.provider === "XERO" ? "Organisation name or short code" : form.provider === "SQUARE" ? "Merchant id" : "Account id (acct_…)"} value={form.externalAccountId} onChange={(e) => setForm({ ...form, externalAccountId: e.target.value })} aria-label="Account id" />
          <Input placeholder="Label (optional)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} aria-label="Label" />
          <Input type="password" placeholder={form.provider === "STRIPE" ? "Restricted API key (read-only)" : "Access token"} value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} aria-label="Access token" autoComplete="off" />
          {form.provider === "XERO" && (
            <>
              <Input type="password" placeholder="Refresh token" value={form.refreshToken} onChange={(e) => setForm({ ...form, refreshToken: e.target.value })} aria-label="Refresh token" autoComplete="off" />
              <Input placeholder="Xero tenant id" value={form.xeroTenantId} onChange={(e) => setForm({ ...form, xeroTenantId: e.target.value })} aria-label="Xero tenant id" />
            </>
          )}
          {form.provider === "SQUARE" && <Input placeholder="Location id (optional)" value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })} aria-label="Location id" />}
          {form.provider !== "XERO" && <Input type="password" placeholder="Webhook signing secret" value={form.webhookSecret} onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })} aria-label="Webhook secret" autoComplete="off" />}
          <Button
            disabled={pending || !form.externalAccountId || form.accessToken.length < 8}
            onClick={() =>
              run(async () => {
                const r = await connectFinanceAction(tenantId, { ...form, label: form.label || undefined, refreshToken: form.refreshToken || undefined, xeroTenantId: form.xeroTenantId || undefined, locationId: form.locationId || undefined, webhookSecret: form.webhookSecret || undefined });
                if (r.ok) setForm({ ...form, externalAccountId: "", label: "", accessToken: "", refreshToken: "", xeroTenantId: "", locationId: "", webhookSecret: "" });
                return r;
              })
            }
          >
            <Link2 /> Connect
          </Button>
        </Panel>
</Section>
    </div>
  );
}

function LinksPanel({ tenantId, tenantSlug, links, pending, run, appUrl, fmt }: { tenantId: string; tenantSlug: string; links: TrackedLinkRecord[]; pending: boolean; run: Run; appUrl: string; fmt: FormatContext }) {
  const [form, setForm] = useState({ destination: "", label: "", code: "", source: "", medium: "", campaign: "" });
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section id="links-title" level="h3" title="Tracked links" lede="Use these on signboards, flyers, bios and posts so the lead carries its campaign." action={<><Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => rollupSiteNowAction(tenantId))}>
            <RefreshCw /> Website numbers
          </Button></>}>
<Panel className="py-5">
          {links.length === 0 ? (
            <p className="py-4 text-base text-muted-foreground">No links yet.</p>
          ) : (
            <ul className="divide-y">
              {links.map((l) => (
                <li key={l.id} className="py-2.5">
                  <p className="text-sm font-medium">
                    {appUrl}/r/{l.code} <span className="text-muted-foreground">· {l.clicks} click{l.clicks === 1 ? "" : "s"}</span>
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {l.label ?? l.destination} · {[l.source, l.medium, l.campaign].filter(Boolean).join(" / ") || "no UTMs"} · {formatDateTime(l.createdAt, fmt).replace(/,.*$/, "")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
</Section>
      <Section id="links-new-title" level="h3" title="New tracked link" lede={<>Short code defaults to {tenantSlug}-xxxxxx.</>}>
<Panel className="py-5 flex flex-col gap-2">
          <Input placeholder="Destination URL (https://…)" value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} aria-label="Destination" />
          <Input placeholder="Label, e.g. Signboard QR — Glenelg" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} aria-label="Label" />
          <div className="grid grid-cols-3 gap-2">
            <Input placeholder="utm_source" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} aria-label="Source" />
            <Input placeholder="utm_medium" value={form.medium} onChange={(e) => setForm({ ...form, medium: e.target.value })} aria-label="Medium" />
            <Input placeholder="utm_campaign" value={form.campaign} onChange={(e) => setForm({ ...form, campaign: e.target.value })} aria-label="Campaign" />
          </div>
          <Input placeholder="Short code (optional)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} aria-label="Short code" />
          <Button
            disabled={pending || !/^https?:\/\//.test(form.destination)}
            onClick={() =>
              run(async () => {
                const r = await createTrackedLinkAction(tenantId, { destination: form.destination, label: form.label || undefined, code: form.code || undefined, source: form.source || undefined, medium: form.medium || undefined, campaign: form.campaign || undefined });
                if (r.ok) setForm({ destination: "", label: "", code: "", source: "", medium: "", campaign: "" });
                return r;
              })
            }
          >
            <Link2 /> Create link
          </Button>
        </Panel>
</Section>
    </div>
  );
}
