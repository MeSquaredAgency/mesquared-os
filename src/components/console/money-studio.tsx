"use client";

import { useState, useTransition } from "react";
import { Check, Link2, RefreshCw, Send } from "lucide-react";
import { Badge, Count } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGrid } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Meta } from "@/components/shell/section";
import { StatusBadge } from "@/components/shell/status-badge";
import type { PacingStatus } from "@/lib/ads/sync";
import { connectAdAccountAction, connectFinanceAction, createTrackedLinkAction, markInvoicePaidAction, rollupSiteNowAction, runRemindersNowAction, setAdBudgetAction, syncAdsNowAction, syncFinanceNowAction } from "@/lib/money/actions";
import type { AdAccountRecord, IntegrationRecord, InvoiceRecord, TrackedLinkRecord } from "@/lib/types";
import { formatDateTime, formatMoney, type FormatContext } from "@/lib/utils";

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

/** A card's title line: an h3 and the sentence under it, with room for actions at the right. */
function CardHead({ id, title, lede, action }: { id: string; title: React.ReactNode; lede?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <h3 id={id} className="section-title">
          {title}
        </h3>
        {lede && <p className="mt-0.5 text-sm text-muted-foreground">{lede}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

/** Operator controls for ads, finance connections, invoices and tracked links. Every button is a server action scoped to the portfolio. */
export function MoneyStudio({ tenantId, tenantSlug, fmt, adAccounts, pacing, financeIntegrations, invoices, links, appUrl }: Props) {
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const run: Run = (fn) => start(async () => setNotice(await fn().then((r) => ({ tone: r.ok ? "ok" : "error", text: r.message }))));
  const open = invoices.filter((i) => i.status === "SENT" || i.status === "OVERDUE");
  const pacingOff = Boolean(pacing && pacing.driftPct !== null && Math.abs(pacing.driftPct) >= 25);

  return (
    <div className="flex flex-col gap-4">
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      <Tabs defaultValue="ads">
        <TabsList variant="segment">
          <TabsTrigger value="ads">
            Ads <Count n={adAccounts.length} tone={pacingOff ? "red" : "neutral"} />
          </TabsTrigger>
          <TabsTrigger value="finance">
            Invoices <Count n={open.length} tone={open.some((i) => i.status === "OVERDUE") ? "red" : "neutral"} />
          </TabsTrigger>
          <TabsTrigger value="links">Tracked links</TabsTrigger>
        </TabsList>
        <TabsContent value="ads">
          <AdsPanel tenantId={tenantId} fmt={fmt} adAccounts={adAccounts} pacing={pacing} pending={pending} run={run} />
        </TabsContent>
        <TabsContent value="finance">
          <FinancePanel tenantId={tenantId} fmt={fmt} integrations={financeIntegrations} invoices={invoices} pending={pending} run={run} appUrl={appUrl} />
        </TabsContent>
        <TabsContent value="links">
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
    <div className="grid gap-6 xl:grid-cols-2">
      <section aria-labelledby="ads-accounts-title" className="surface flex flex-col gap-3 p-5">
        <CardHead
          id="ads-accounts-title"
          title="Ad accounts and pacing"
          lede={pacing ? `${m(pacing.spentCents)} spent of ${m(pacing.budgetCents)} planned by day ${pacing.daysElapsed} of ${pacing.daysInMonth}${pacing.driftPct !== null ? ` (${pacing.driftPct > 0 ? "+" : ""}${pacing.driftPct}% vs plan, heading for ${m(pacing.projectedCents)})` : ""}.` : "Set a monthly budget on each account to get pacing alerts."}
          action={
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => syncAdsNowAction(tenantId))}>
              <RefreshCw /> Sync now
            </Button>
          }
        />
        {adAccounts.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No ad accounts connected.</p>
        ) : (
          <ul className="divide-y">
            {adAccounts.map((a) => (
              <li key={a.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">
                      {a.platform === "META" ? "Meta" : "Google Ads"} <span className="font-normal text-muted-foreground">· {a.name ?? a.externalAccountId}</span>
                    </p>
                    <Badge variant={a.lastError ? "red" : a.isActive ? "green" : "muted"}>{a.lastError ? "Needs attention" : a.isActive ? "Active" : "Off"}</Badge>
                  </div>
                  <Meta parts={[a.lastSyncAt ? `synced ${formatDateTime(a.lastSyncAt, fmt)}` : "not synced yet", a.lastError]} />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Input className="h-8 w-32" type="number" min={0} placeholder={a.monthlyBudgetCents != null ? String(a.monthlyBudgetCents / 100) : "Budget / month"} value={budgets[a.id] ?? ""} onChange={(e) => setBudgets({ ...budgets, [a.id]: e.target.value })} aria-label={`Monthly budget for ${a.name ?? a.externalAccountId}`} />
                  <Button size="sm" variant="outline" disabled={pending || budgets[a.id] === undefined || budgets[a.id] === ""} onClick={() => run(() => setAdBudgetAction(tenantId, a.id, Number(budgets[a.id])))}>
                    <Check /> Save
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="ads-connect-title" className="surface flex flex-col gap-4 p-5">
        <CardHead id="ads-connect-title" title="Connect an ad account" lede="Read-only access: spend and results only. Tokens are encrypted and never shown again." />
        <Field label="Platform">
          <Select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value as "META" | "GOOGLE_ADS" })} aria-label="Platform">
            <option value="META">Meta (Facebook & Instagram)</option>
            <option value="GOOGLE_ADS">Google Ads</option>
          </Select>
        </Field>
        <FieldGrid>
          <Field label="Account id">
            <Input placeholder={form.platform === "META" ? "Ad account id (act_…)" : "Customer id (123-456-7890)"} value={form.externalAccountId} onChange={(e) => setForm({ ...form, externalAccountId: e.target.value })} aria-label="Account id" />
          </Field>
          <Field label="Name" hint="Optional.">
            <Input placeholder="Name (optional)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Account name" />
          </Field>
        </FieldGrid>
        <Field label={`Monthly budget in ${fmt.currency}`} hint="Optional; needed for pacing alerts.">
          <Input type="number" min={0} placeholder={`Monthly budget in ${fmt.currency} (optional)`} value={form.monthlyBudget} onChange={(e) => setForm({ ...form, monthlyBudget: e.target.value })} aria-label="Monthly budget" />
        </Field>
        <Field label="Access token">
          <Input type="password" placeholder="Access token" value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} aria-label="Access token" autoComplete="off" />
        </Field>
        {form.platform === "GOOGLE_ADS" && (
          <>
            <FieldGrid>
              <Field label="Refresh token">
                <Input type="password" placeholder="Refresh token" value={form.refreshToken} onChange={(e) => setForm({ ...form, refreshToken: e.target.value })} aria-label="Refresh token" autoComplete="off" />
              </Field>
              <Field label="Developer token">
                <Input type="password" placeholder="Developer token" value={form.developerToken} onChange={(e) => setForm({ ...form, developerToken: e.target.value })} aria-label="Developer token" autoComplete="off" />
              </Field>
            </FieldGrid>
            <Field label="Manager (login) customer id" hint="If any.">
              <Input placeholder="Manager (login) customer id, if any" value={form.loginCustomerId} onChange={(e) => setForm({ ...form, loginCustomerId: e.target.value })} aria-label="Login customer id" />
            </Field>
          </>
        )}
        <div>
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
        </div>
      </section>
    </div>
  );
}

function FinancePanel({ tenantId, fmt, integrations, invoices, pending, run, appUrl }: { tenantId: string; fmt: FormatContext; integrations: IntegrationRecord[]; invoices: InvoiceRecord[]; pending: boolean; run: Run; appUrl: string }) {
  const [form, setForm] = useState({ provider: "XERO" as "SQUARE" | "STRIPE" | "XERO", externalAccountId: "", label: "", accessToken: "", refreshToken: "", xeroTenantId: "", locationId: "", webhookSecret: "" });
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section aria-labelledby="invoices-ops-title" className="surface flex flex-col gap-3 p-5">
        <CardHead
          id="invoices-ops-title"
          title="Invoices"
          lede="Reminders go out before the due date and chase while overdue; after the last one a person is asked to call."
          action={
            <>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => syncFinanceNowAction(tenantId))}>
                <RefreshCw /> Sync
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => runRemindersNowAction(tenantId))}>
                <Send /> Run reminders
              </Button>
            </>
          }
        />
        {integrations.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {integrations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium">{i.label ?? i.provider}</span>
                <Badge variant={i.status === "CONNECTED" ? "green" : "red"}>{i.status === "CONNECTED" ? "Connected" : "Needs attention"}</Badge>
                {(i.provider === "SQUARE" || i.provider === "STRIPE") && (
                  <span className="min-w-0 break-all text-muted-foreground">
                    webhook: {appUrl}/api/v1/webhooks/{i.provider.toLowerCase()}/{i.id}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {invoices.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No invoices yet.</p>
        ) : (
          <ul className="divide-y">
            {invoices.slice(0, 15).map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="text-sm">
                    <span className="font-medium">{i.number ? `#${i.number}` : "Invoice"}</span> · {i.customerName ?? i.customerEmail ?? "customer"} · <span className="num">{formatMoney(i.status === "PAID" ? i.amountCents : i.amountDueCents, i.currency, fmt.locale)}</span>
                  </p>
                  <Meta parts={[i.dueAt ? `due ${formatDateTime(i.dueAt, fmt).replace(/,.*$/, "")}` : "no due date", i.remindersSent ? `${i.remindersSent} reminder${i.remindersSent === 1 ? "" : "s"}` : null]} />
                </div>
                <div className="flex shrink-0 items-center gap-2">
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
      </section>

      <section aria-labelledby="finance-connect-title" className="surface flex flex-col gap-4 p-5">
        <CardHead id="finance-connect-title" title="Connect a finance provider" lede="Read-only. Square and Stripe also push payments in real time through their webhook; paste the signing secret for that." />
        <Field label="Provider">
          <Select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value as "SQUARE" | "STRIPE" | "XERO" })} aria-label="Provider">
            <option value="XERO">Xero</option>
            <option value="SQUARE">Square</option>
            <option value="STRIPE">Stripe</option>
          </Select>
        </Field>
        <FieldGrid>
          <Field label="Account id">
            <Input placeholder={form.provider === "XERO" ? "Organisation name or short code" : form.provider === "SQUARE" ? "Merchant id" : "Account id (acct_…)"} value={form.externalAccountId} onChange={(e) => setForm({ ...form, externalAccountId: e.target.value })} aria-label="Account id" />
          </Field>
          <Field label="Label" hint="Optional.">
            <Input placeholder="Label (optional)" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} aria-label="Label" />
          </Field>
        </FieldGrid>
        <Field label={form.provider === "STRIPE" ? "Restricted API key" : "Access token"}>
          <Input type="password" placeholder={form.provider === "STRIPE" ? "Restricted API key (read-only)" : "Access token"} value={form.accessToken} onChange={(e) => setForm({ ...form, accessToken: e.target.value })} aria-label="Access token" autoComplete="off" />
        </Field>
        {form.provider === "XERO" && (
          <FieldGrid>
            <Field label="Refresh token">
              <Input type="password" placeholder="Refresh token" value={form.refreshToken} onChange={(e) => setForm({ ...form, refreshToken: e.target.value })} aria-label="Refresh token" autoComplete="off" />
            </Field>
            <Field label="Xero tenant id">
              <Input placeholder="Xero tenant id" value={form.xeroTenantId} onChange={(e) => setForm({ ...form, xeroTenantId: e.target.value })} aria-label="Xero tenant id" />
            </Field>
          </FieldGrid>
        )}
        {form.provider === "SQUARE" && (
          <Field label="Location id" hint="Optional.">
            <Input placeholder="Location id (optional)" value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })} aria-label="Location id" />
          </Field>
        )}
        {form.provider !== "XERO" && (
          <Field label="Webhook signing secret">
            <Input type="password" placeholder="Webhook signing secret" value={form.webhookSecret} onChange={(e) => setForm({ ...form, webhookSecret: e.target.value })} aria-label="Webhook secret" autoComplete="off" />
          </Field>
        )}
        <div>
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
        </div>
      </section>
    </div>
  );
}

function LinksPanel({ tenantId, tenantSlug, links, pending, run, appUrl, fmt }: { tenantId: string; tenantSlug: string; links: TrackedLinkRecord[]; pending: boolean; run: Run; appUrl: string; fmt: FormatContext }) {
  const [form, setForm] = useState({ destination: "", label: "", code: "", source: "", medium: "", campaign: "" });
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section aria-labelledby="links-title" className="surface flex flex-col gap-3 p-5">
        <CardHead
          id="links-title"
          title="Tracked links"
          lede="Use these on signboards, flyers, bios and posts so the lead carries its campaign."
          action={
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => rollupSiteNowAction(tenantId))}>
              <RefreshCw /> Website numbers
            </Button>
          }
        />
        {links.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No links yet.</p>
        ) : (
          <ul className="divide-y">
            {links.map((l) => (
              <li key={l.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {appUrl}/r/{l.code}
                  </p>
                  <Meta parts={[l.label ?? l.destination, [l.source, l.medium, l.campaign].filter(Boolean).join(" / ") || "no UTMs", formatDateTime(l.createdAt, fmt).replace(/,.*$/, "")]} className="truncate" />
                </div>
                <span className="shrink-0 text-sm text-muted-foreground num">
                  {l.clicks} click{l.clicks === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="links-new-title" className="surface flex flex-col gap-4 p-5">
        <CardHead id="links-new-title" title="New tracked link" lede={<>Short code defaults to {tenantSlug}-xxxxxx.</>} />
        <Field label="Destination URL">
          <Input placeholder="https://…" value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} aria-label="Destination" />
        </Field>
        <Field label="Label">
          <Input placeholder="e.g. Signboard QR — Glenelg" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} aria-label="Label" />
        </Field>
        <FieldGrid columns={3}>
          <Field label="utm_source">
            <Input placeholder="utm_source" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} aria-label="Source" />
          </Field>
          <Field label="utm_medium">
            <Input placeholder="utm_medium" value={form.medium} onChange={(e) => setForm({ ...form, medium: e.target.value })} aria-label="Medium" />
          </Field>
          <Field label="utm_campaign">
            <Input placeholder="utm_campaign" value={form.campaign} onChange={(e) => setForm({ ...form, campaign: e.target.value })} aria-label="Campaign" />
          </Field>
        </FieldGrid>
        <Field label="Short code" hint="Optional.">
          <Input placeholder="Short code (optional)" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} aria-label="Short code" />
        </Field>
        <div>
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
        </div>
      </section>
    </div>
  );
}
