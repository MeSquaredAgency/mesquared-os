"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Copy, KeyRound, Trash2, UserPlus, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { AUTOMATION_BY_KEY } from "@/lib/automations/registry";
import { MODULE_BY_KEY } from "@/lib/modules/registry";
import { assignOperatorAction, importInventoryAction, inviteMemberAction, issueApiKeyAction, removeMemberAction, revokeApiKeyAction, saveEscalationRulesAction, saveOpportunityValuesAction, saveTenantSettingsAction, setAutomationAction, setModuleAction } from "@/lib/tenants/actions";
import type { ApiKeyRecord, InventoryItemRecord, ReadinessCheck, TenantAutomationRecord, TenantModuleRecord, TenantPersonRecord, TenantRoleRecord, TenantSummary, UserRecord } from "@/lib/types";
import { cn, formatDateTime, humanize, type FormatContext } from "@/lib/utils";

interface Props {
  tenant: TenantSummary;
  isAdmin: boolean;
  fmt: FormatContext;
  readiness: ReadinessCheck[];
  platformReadiness: ReadinessCheck[];
  brand: { voice: string | null; bannedPhrases: string[]; requiredFooter: string; claimsPolicy: string };
  roles: TenantRoleRecord[];
  people: TenantPersonRecord[];
  operators: UserRecord[];
  keys: ApiKeyRecord[];
  modules: TenantModuleRecord[];
  automations: TenantAutomationRecord[];
  inventory: InventoryItemRecord[];
}

type Run = (fn: () => Promise<{ ok: boolean; message: string }>) => void;

const OPPORTUNITY_TYPES = ["UNANSWERED_ENQUIRY", "MISSED_CALL", "ABANDONED_FORM", "NOT_BOOKED", "NO_SHOW", "QUIET_QUOTE", "UNREPLIED_DM", "UNREPLIED_COMMENT", "UNANSWERED_REVIEW", "LAPSED_CUSTOMER"] as const;

export function SettingsStudio(props: Props) {
  const { tenant, readiness, platformReadiness } = props;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  // The page is dynamic, so after a change the server data is re-fetched explicitly rather than relying on revalidation alone.
  const run: Run = (fn) =>
    start(async () => {
      const r = await fn();
      setNotice({ tone: r.ok ? "ok" : "error", text: r.message });
      if (r.ok) router.refresh();
    });
  const required = readiness.filter((c) => c.level === "required");
  const ready = required.every((c) => c.ok);

  return (
    <div className="flex flex-col gap-3">
      {notice && (
        <p role="status" aria-live="polite" className={cn("whitespace-pre-wrap rounded-md px-3 py-2 text-sm", notice.tone === "ok" ? "bg-green-soft text-green-text" : "bg-red-soft text-red-text")}>
          {notice.text}
        </p>
      )}
      <Tabs defaultValue="readiness">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="readiness">
            Launch readiness <Badge variant={ready ? "green" : "secondary"}>{required.filter((c) => c.ok).length}/{required.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="business">Business</TabsTrigger>
          <TabsTrigger value="people">People</TabsTrigger>
          <TabsTrigger value="keys">API keys</TabsTrigger>
          <TabsTrigger value="switches">Modules &amp; automations</TabsTrigger>
          <TabsTrigger value="escalation">Escalation &amp; values</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
        </TabsList>
        <TabsContent value="readiness" className="mt-3">
          <ReadinessPanel tenant={tenant} checks={readiness} platform={platformReadiness} />
        </TabsContent>
        <TabsContent value="business" className="mt-3">
          <BusinessPanel {...props} pending={pending} run={run} />
        </TabsContent>
        <TabsContent value="people" className="mt-3">
          <PeoplePanel {...props} pending={pending} run={run} />
        </TabsContent>
        <TabsContent value="keys" className="mt-3">
          <KeysPanel {...props} pending={pending} run={run} />
        </TabsContent>
        <TabsContent value="switches" className="mt-3">
          <SwitchesPanel {...props} pending={pending} run={run} />
        </TabsContent>
        <TabsContent value="escalation" className="mt-3">
          <EscalationPanel {...props} pending={pending} run={run} />
        </TabsContent>
        <TabsContent value="inventory" className="mt-3">
          <InventoryPanel {...props} pending={pending} run={run} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CheckList({ checks }: { checks: ReadinessCheck[] }) {
  return (
    <ul className="divide-y">
      {checks.map((c) => (
        <li key={c.key} className="flex items-start justify-between gap-3 py-2">
          <div className="min-w-0">
            <p className="text-sm font-medium">{c.label}</p>
            <p className="text-xs text-muted-foreground">{c.detail}</p>
          </div>
          <Badge variant={c.ok ? "green" : c.level === "required" ? "red" : c.level === "recommended" ? "secondary" : "muted"}>{c.ok ? "Ready" : c.level === "required" ? "Needed" : c.level === "recommended" ? "Recommended" : "Optional"}</Badge>
        </li>
      ))}
    </ul>
  );
}

function ReadinessPanel({ tenant, checks, platform }: { tenant: TenantSummary; checks: ReadinessCheck[]; platform: ReadinessCheck[] }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card aria-labelledby="readiness-ws-title">
        <CardHeader>
          <CardTitle id="readiness-ws-title">{tenant.name}: workspace</CardTitle>
          <CardDescription>The success test: every lead answered in minutes, missed opportunities visible, a week of content approvable, ad spend tied to leads.</CardDescription>
        </CardHeader>
        <CardContent>
          <CheckList checks={checks} />
        </CardContent>
      </Card>
      <Card aria-labelledby="readiness-platform-title">
        <CardHeader>
          <CardTitle id="readiness-platform-title">Deployment</CardTitle>
          <CardDescription>Applies to every workspace on this deployment.</CardDescription>
        </CardHeader>
        <CardContent>
          <CheckList checks={platform} />
        </CardContent>
      </Card>
    </div>
  );
}

function BusinessPanel({ tenant, brand, pending, run }: Props & { pending: boolean; run: Run }) {
  const [f, setF] = useState({
    name: tenant.name,
    fromName: tenant.branding.fromName ?? "",
    replyTo: tenant.branding.replyTo ?? "",
    primaryColor: tenant.branding.primaryColor ?? "",
    signAsAssignee: Boolean(tenant.branding.signAsAssignee),
    firstResponseMinutes: String(tenant.sla.firstResponseMinutes),
    bookingWindowHours: String(tenant.sla.bookingWindowHours),
    quietStart: String(tenant.sla.quietHours?.start ?? 21),
    quietEnd: String(tenant.sla.quietHours?.end ?? 8),
    serviceAreas: (tenant.qualificationRules.serviceAreas ?? []).join(", "),
    greenCriteria: (tenant.qualificationRules.greenCriteria ?? []).join("\n"),
    autoHandled: (tenant.qualificationRules.autoHandled ?? []).join("\n"),
    highIntentServices: (tenant.qualificationRules.highIntentServices ?? []).join(", "),
    requirePhone: Boolean(tenant.qualificationRules.requirePhone),
    voice: brand.voice ?? "",
    bannedPhrases: brand.bannedPhrases.join(", "),
    requiredFooter: brand.requiredFooter,
    claimsPolicy: brand.claimsPolicy,
  });
  const field = (label: string, key: keyof typeof f, props: Record<string, unknown> = {}) => (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <Input value={String(f[key])} onChange={(e) => setF({ ...f, [key]: e.target.value })} {...props} />
    </label>
  );
  const area = (label: string, key: keyof typeof f, hint: string) => (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <Textarea rows={3} value={String(f[key])} onChange={(e) => setF({ ...f, [key]: e.target.value })} placeholder={hint} />
    </label>
  );
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Business and service levels</CardTitle>
          <CardDescription>How messages are signed, how fast leads must be answered, when not to message.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {field("Business name", "name")}
          <div className="grid gap-3 sm:grid-cols-2">
            {field("Sender name", "fromName")}
            {field("Reply-to email", "replyTo", { type: "email" })}
            {field("Brand colour", "primaryColor", { placeholder: "#0f4c81" })}
            {field("Service areas (comma separated)", "serviceAreas")}
            {field("First response within (minutes)", "firstResponseMinutes", { type: "number", min: 1 })}
            {field("Booking window (hours)", "bookingWindowHours", { type: "number", min: 1 })}
            {field("Quiet hours start (0–23)", "quietStart", { type: "number", min: 0, max: 23 })}
            {field("Quiet hours end (0–23)", "quietEnd", { type: "number", min: 0, max: 23 })}
          </div>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={f.signAsAssignee} onChange={(e) => setF({ ...f, signAsAssignee: e.target.checked })} /> Sign messages as the person assigned to the lead (replies go to them; the business name and number stay the same)
          </label>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Qualification, brand and compliance</CardTitle>
          <CardDescription>Read by the lead qualifier and enforced on every piece of content.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {area("What makes a lead worth a person's time (one per line)", "greenCriteria", "wants an appraisal\nowner of an investment property")}
          {area("Enquiries handled automatically (one per line)", "autoHandled", "rental availability questions\ninvoice and supplier emails")}
          {field("Services people ask for (comma separated)", "highIntentServices", { placeholder: "appraisal, property management" })}
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={f.requirePhone} onChange={(e) => setF({ ...f, requirePhone: e.target.checked })} /> A phone number is required for a lead to need a person
          </label>
          {area("Brand voice", "voice", "Local, knowledgeable and calm. Plain English.")}
          {field("Banned phrases (comma separated)", "bannedPhrases")}
          {field("Line every email and asset must carry", "requiredFooter", { placeholder: "Business Name | Licence 000000" })}
          {field("Claims policy", "claimsPolicy", { placeholder: "Only state prices and figures from a record on file." })}
          <Button
            variant="green"
            disabled={pending}
            onClick={() =>
              run(() =>
                saveTenantSettingsAction(tenant.id, {
                  name: f.name,
                  fromName: f.fromName,
                  replyTo: f.replyTo,
                  primaryColor: f.primaryColor,
                  signAsAssignee: f.signAsAssignee,
                  firstResponseMinutes: Number(f.firstResponseMinutes),
                  bookingWindowHours: Number(f.bookingWindowHours),
                  quietStart: Number(f.quietStart),
                  quietEnd: Number(f.quietEnd),
                  serviceAreas: f.serviceAreas,
                  greenCriteria: f.greenCriteria,
                  autoHandled: f.autoHandled,
                  highIntentServices: f.highIntentServices,
                  requirePhone: f.requirePhone,
                  voice: f.voice,
                  bannedPhrases: f.bannedPhrases,
                  requiredFooter: f.requiredFooter,
                  claimsPolicy: f.claimsPolicy,
                }),
              )
            }
          >
            <Check /> Save settings
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function PeoplePanel({ tenant, roles, people, operators, isAdmin, pending, run }: Props & { pending: boolean; run: Run }) {
  const [invite, setInvite] = useState({ email: "", name: "", roleId: roles[0]?.id ?? "" });
  const [reveal, setReveal] = useState<{ email: string; password: string } | null>(null);
  const [operatorId, setOperatorId] = useState(operators[0]?.id ?? "");
  const members = people.filter((p) => p.via === "member");
  const assigned = people.filter((p) => p.via === "operator");
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>People at {tenant.name}</CardTitle>
          <CardDescription>Roles decide what each person sees: finances, approvals, lead alerts, user management, all records or own.</CardDescription>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">Nobody from the client yet.</p>
          ) : (
            <ul className="divide-y">
              {members.map((p) => (
                <li key={p.userId} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{p.name ?? p.email}</p>
                    <p className="text-xs text-muted-foreground">
                      {p.email} · {p.roleName} · {p.permissions.map((x) => humanize(x).toLowerCase()).join(", ") || "no permissions"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => run(async () => { const r = await inviteMemberAction(tenant.id, { email: p.email, roleId: p.roleId ?? roles[0]?.id ?? "", resetPassword: true }); if (r.ok && r.temporaryPassword) setReveal({ email: p.email, password: r.temporaryPassword }); return r; })}>
                      <KeyRound /> Reset password
                    </Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => removeMemberAction(tenant.id, p.userId))}>
                      <Trash2 /> Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs font-medium text-muted-foreground">Me² operators</p>
          <ul className="divide-y">
            {assigned.map((p) => (
              <li key={p.userId} className="py-1.5 text-sm">
                {p.name ?? p.email} <span className="text-muted-foreground">· {p.email}</span>
              </li>
            ))}
            {assigned.length === 0 && <li className="py-1.5 text-sm text-muted-foreground">No operator assigned (platform admins always have access).</li>}
          </ul>
          {isAdmin && operators.length > 0 && (
            <div className="mt-2 flex gap-2">
              <select className="h-8 rounded-md border bg-background px-2 text-xs" value={operatorId} onChange={(e) => setOperatorId(e.target.value)} aria-label="Operator">
                {operators.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name ?? o.email}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="outline" disabled={pending || !operatorId} onClick={() => run(() => assignOperatorAction(tenant.id, operatorId))}>
                Assign operator
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Invite a person</CardTitle>
          <CardDescription>New accounts get a one-time password to hand over privately. They sign in at /login.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {reveal && (
            <div className="rounded-md border bg-muted p-3 text-sm">
              <p className="font-medium">{reveal.email}</p>
              <p className="font-mono text-base">{reveal.password}</p>
              <p className="text-xs text-muted-foreground">Shown once. Ask them to change it after signing in.</p>
            </div>
          )}
          <Input type="email" placeholder="Email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} aria-label="Email" />
          <Input placeholder="Name" value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} aria-label="Name" />
          <select className="h-9 rounded-md border bg-background px-3 text-sm" value={invite.roleId} onChange={(e) => setInvite({ ...invite, roleId: e.target.value })} aria-label="Role">
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} — {r.permissions.map((x) => humanize(x).toLowerCase()).join(", ") || "no permissions"}
              </option>
            ))}
          </select>
          <Button variant="green" disabled={pending || !invite.email.includes("@") || !invite.roleId} onClick={() => run(async () => { const r = await inviteMemberAction(tenant.id, invite); if (r.ok) { if (r.temporaryPassword) setReveal({ email: invite.email, password: r.temporaryPassword }); setInvite({ ...invite, email: "", name: "" }); } return r; })}>
            <UserPlus /> Invite
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function KeysPanel({ tenant, keys, fmt, pending, run }: Props & { pending: boolean; run: Run }) {
  const [label, setLabel] = useState("Website forms");
  const [scopes, setScopes] = useState<{ intake: boolean; content: boolean }>({ intake: true, content: false });
  const [raw, setRaw] = useState<string | null>(null);
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>API keys</CardTitle>
          <CardDescription>Intake keys go in public web forms, call tracking and review feeds. Content keys upload files and material and must stay private.</CardDescription>
        </CardHeader>
        <CardContent>
          {keys.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No keys issued yet.</p>
          ) : (
            <ul className="divide-y">
              {keys.map((k) => (
                <li key={k.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {k.label} <span className="font-mono text-xs text-muted-foreground">{k.keyPrefix}…</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {k.scopes.join(" + ")} · issued {formatDateTime(k.createdAt, fmt).replace(/,.*$/, "")}
                      {k.lastUsedAt ? ` · last used ${formatDateTime(k.lastUsedAt, fmt)}` : " · never used"}
                    </p>
                  </div>
                  {k.revokedAt ? (
                    <Badge variant="muted">Revoked</Badge>
                  ) : (
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => revokeApiKeyAction(tenant.id, k.id))}>
                      <Trash2 /> Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Issue a key</CardTitle>
          <CardDescription>The key is shown once. Put it in the form as a hidden field or the x-api-key header.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {raw && (
            <div className="rounded-md border bg-muted p-3">
              <p className="break-all font-mono text-sm">{raw}</p>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => navigator.clipboard?.writeText(raw)}>
                <Copy /> Copy
              </Button>
            </div>
          )}
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" aria-label="Key label" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={scopes.intake} onChange={(e) => setScopes({ ...scopes, intake: e.target.checked })} /> intake (forms, calls, reviews, page beacon)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={scopes.content} onChange={(e) => setScopes({ ...scopes, content: e.target.checked })} /> content (uploads and material; keep private)
          </label>
          <Button variant="green" disabled={pending || (!scopes.intake && !scopes.content)} onClick={() => run(async () => { const r = await issueApiKeyAction(tenant.id, label, [...(scopes.intake ? ["intake" as const] : []), ...(scopes.content ? ["content" as const] : [])]); if (r.ok && r.rawKey) setRaw(r.rawKey); return r; })}>
            <KeyRound /> Issue key
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function SwitchesPanel({ tenant, modules, automations, pending, run }: Props & { pending: boolean; run: Run }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Modules</CardTitle>
          <CardDescription>What this workspace runs.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {modules.map((m) => (
              <li key={m.moduleKey} className="flex items-center justify-between gap-2 py-2">
                <div>
                  <p className="text-sm font-medium">{MODULE_BY_KEY[m.moduleKey]?.name ?? m.moduleKey}</p>
                  <p className="text-xs text-muted-foreground">{MODULE_BY_KEY[m.moduleKey]?.description}</p>
                </div>
                <Button size="sm" variant={m.enabled ? "green" : "outline"} disabled={pending} onClick={() => run(() => setModuleAction(tenant.id, m.moduleKey, !m.enabled))}>
                  {m.enabled ? "On" : "Off"}
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Automations</CardTitle>
          <CardDescription>Each one logs what it did in plain words. Reactivation stays off for real estate unless the client asks.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {automations.map((a) => (
              <li key={a.typeKey} className="flex items-center justify-between gap-2 py-2">
                <div>
                  <p className="text-sm font-medium">{AUTOMATION_BY_KEY[a.typeKey]?.name ?? a.typeKey}</p>
                  <p className="text-xs text-muted-foreground">{AUTOMATION_BY_KEY[a.typeKey]?.description}</p>
                </div>
                <Button size="sm" variant={a.enabled ? "green" : "outline"} disabled={pending} onClick={() => run(() => setAutomationAction(tenant.id, a.typeKey, !a.enabled))}>
                  {a.enabled ? "On" : "Off"}
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function EscalationPanel({ tenant, people, fmt, pending, run }: Props & { pending: boolean; run: Run }) {
  const members = people.filter((p) => p.via === "member");
  const [rules, setRules] = useState<Record<string, string>>(Object.fromEntries(tenant.escalationRules.map((r) => [r.when, r.notifyUserId])));
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(OPPORTUNITY_TYPES.map((t) => [t, String((tenant.opportunityValues[t] ?? 0) / 100)])));
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Who at the client hears about what</CardTitle>
          <CardDescription>By default missed opportunities go to Me² operators. Name a client person here and they are emailed as well.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {members.length === 0 && <p className="text-sm text-muted-foreground">Invite someone from the client first.</p>}
          {["*", ...OPPORTUNITY_TYPES].map((t) => (
            <label key={t} className="flex items-center justify-between gap-2 text-sm">
              <span>{t === "*" ? "Everything" : humanize(t)}</span>
              <select className="h-8 w-56 rounded-md border bg-background px-2 text-xs" value={rules[t] ?? ""} onChange={(e) => setRules({ ...rules, [t]: e.target.value })}>
                <option value="">Operators only</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name ?? m.email}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <Button variant="green" disabled={pending} onClick={() => run(() => saveEscalationRulesAction(tenant.id, Object.entries(rules).filter(([, v]) => v).map(([when, notifyUserId]) => ({ when, notifyUserId }))))}>
            <Check /> Save rules
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>What a missed opportunity is worth</CardTitle>
          <CardDescription>In {fmt.currency}. Drives the “money at risk” and “recovered” figures the client sees.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {OPPORTUNITY_TYPES.map((t) => (
            <label key={t} className="flex items-center justify-between gap-2 text-sm">
              <span>{humanize(t)}</span>
              <Input type="number" min={0} className="h-8 w-32 text-xs" value={values[t]} onChange={(e) => setValues({ ...values, [t]: e.target.value })} aria-label={`Value of ${humanize(t)}`} />
            </label>
          ))}
          <Button variant="green" disabled={pending} onClick={() => run(() => saveOpportunityValuesAction(tenant.id, Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)]))))}>
            <Check /> Save values
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function InventoryPanel({ tenant, inventory, modules, fmt, pending, run }: Props & { pending: boolean; run: Run }) {
  const [csv, setCsv] = useState("");
  const on = modules.find((m) => m.moduleKey === "inventory")?.enabled;
  const money = (c: number | null) => (c === null ? "" : (c / 100).toLocaleString(fmt.locale, { style: "currency", currency: fmt.currency, maximumFractionDigits: 0 }));
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Listings and stock</CardTitle>
          <CardDescription>{on ? "New active listings become content-engine material; an enquiry that names one gets its link in the automatic reply." : "The inventory module is off for this workspace; switch it on under Modules to use this."}</CardDescription>
        </CardHeader>
        <CardContent>
          {inventory.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">Nothing imported yet.</p>
          ) : (
            <ul className="divide-y">
              {inventory.slice(0, 30).map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{i.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {humanize(i.type)}
                      {typeof i.attributes.suburb === "string" ? ` · ${i.attributes.suburb}` : ""}
                      {typeof i.attributes.rentPerWeekCents === "number" ? ` · ${money(i.attributes.rentPerWeekCents)}/wk` : i.valueCents ? ` · ${money(i.valueCents)}` : ""}
                    </p>
                  </div>
                  <Badge variant={i.status === "ACTIVE" ? "green" : i.status === "LOW" ? "secondary" : "muted"}>{humanize(i.status)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Import from CSV</CardTitle>
          <CardDescription>A header row, then one item per line. Columns understood: address or name, status, rent, price, bedrooms, bathrooms, suburb, url, available, reference, quantity.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Textarea rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={"address,suburb,status,rent,bedrooms,url\n12 Marine Parade,Glenelg,available,620,2,https://…"} aria-label="CSV" />
          <Button variant="green" disabled={pending || csv.trim().length < 10} onClick={() => run(async () => { const r = await importInventoryAction(tenant.id, csv); if (r.ok) setCsv(""); return r; })}>
            <Upload /> Import
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
