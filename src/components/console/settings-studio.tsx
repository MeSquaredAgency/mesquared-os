"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Check, Copy, KeyRound, Trash2, UserPlus, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Panel, Section } from "@/components/shell/section";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { AUTOMATION_BY_KEY } from "@/lib/automations/registry";
import { MODULE_BY_KEY } from "@/lib/modules/registry";
import { assignOperatorAction, importInventoryAction, inviteMemberAction, issueApiKeyAction, removeMemberAction, revokeApiKeyAction, saveEscalationRulesAction, saveOpportunityValuesAction, saveTenantSettingsAction, setAutomationAction, setModuleAction, updateMemberProfileAction } from "@/lib/tenants/actions";
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

/** A second look before something that cannot be undone. */
const confirmed = (question: string) => typeof window === "undefined" || window.confirm(question);

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
        <p role="status" aria-live="polite" className={cn("whitespace-pre-wrap rounded-lg px-4 py-3 text-sm", notice.tone === "ok" ? "bg-green-soft text-green-text" : "bg-red-soft text-red-text")}>
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
      <Section id="readiness-ws-title" title={<>{tenant.name}: workspace</>} lede="The success test: every lead answered in minutes, missed opportunities visible, a week of content approvable, ad spend tied to leads.">
<Panel className="py-5">
          <CheckList checks={checks} />
        </Panel>
</Section>
      <Section id="readiness-platform-title" title="Deployment" lede="Applies to every workspace on this deployment.">
<Panel className="py-5">
          <CheckList checks={platform} />
        </Panel>
</Section>
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
    logoUrl: tenant.branding.logoUrl ?? "",
    website: tenant.branding.website ?? "",
    phone: tenant.branding.phone ?? "",
    addresses: (tenant.branding.addresses ?? []).join("\n"),
    facebook: tenant.branding.social?.facebook ?? "",
    instagram: tenant.branding.social?.instagram ?? "",
    youtube: tenant.branding.social?.youtube ?? "",
    linkedin: tenant.branding.social?.linkedin ?? "",
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
      <Section id="business-and-service-levels-title" title="Business and service levels" lede="How messages are signed, how fast leads must be answered, when not to message.">
<Panel className="py-5 flex flex-col gap-3">
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
          <p className="pt-2 text-xs font-medium text-muted-foreground">Email signature: logo, contact details and offices shown under every email</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {field("Logo image address (https)", "logoUrl", { placeholder: "https://example.com.au/logo.png" })}
            {field("Website", "website", { placeholder: "example.com.au" })}
            {field("Office phone", "phone", { placeholder: "1300 000 000" })}
            {field("Facebook page", "facebook", { placeholder: "https://www.facebook.com/…" })}
            {field("Instagram profile", "instagram", { placeholder: "https://instagram.com/…" })}
            {field("YouTube channel", "youtube", { placeholder: "https://www.youtube.com/@…" })}
          </div>
          {area("Offices (one per line)", "addresses", "Adelaide: Level 1 / 1 Example Rd, Suburb\nMount Gambier: 1 Example St")}
        </Panel>
</Section>
      <Section id="qualification-brand-and-compliance-title" title="Qualification, brand and compliance" lede="Read by the lead qualifier and enforced on every piece of content.">
<Panel className="py-5 flex flex-col gap-3">
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
            disabled={pending}
            onClick={() =>
              run(() =>
                saveTenantSettingsAction(tenant.id, {
                  name: f.name,
                  fromName: f.fromName,
                  replyTo: f.replyTo,
                  primaryColor: f.primaryColor,
                  signAsAssignee: f.signAsAssignee,
                  logoUrl: f.logoUrl,
                  website: f.website,
                  phone: f.phone,
                  addresses: f.addresses,
                  facebook: f.facebook,
                  instagram: f.instagram,
                  youtube: f.youtube,
                  linkedin: f.linkedin,
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
        </Panel>
</Section>
    </div>
  );
}

function PeoplePanel({ tenant, roles, people, operators, isAdmin, pending, run }: Props & { pending: boolean; run: Run }) {
  const [invite, setInvite] = useState({ email: "", name: "", roleId: roles[0]?.id ?? "" });
  const [reveal, setReveal] = useState<{ email: string; password: string } | null>(null);
  // A one-time password must not sit on a shared screen: it clears itself.
  useEffect(() => {
    if (!reveal) return;
    const timer = setTimeout(() => setReveal(null), 120_000);
    return () => clearTimeout(timer);
  }, [reveal]);
  const [operatorId, setOperatorId] = useState(operators[0]?.id ?? "");
  const [editing, setEditing] = useState<string | null>(null);
  const [profile, setProfile] = useState({ title: "", phone: "", photoUrl: "" });
  const members = people.filter((p) => p.via === "member");
  const assigned = people.filter((p) => p.via === "operator");
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section id="people-at-title" title={<>People at {tenant.name}</>} lede="Roles decide what each person sees: finances, approvals, lead alerts, user management, all records or own.">
<Panel className="py-5">
          {members.length === 0 ? (
            <p className="py-4 text-base text-muted-foreground">Nobody from the client yet.</p>
          ) : (
            <ul className="divide-y">
              {members.map((p) => (
                <li key={p.userId} className="py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {p.name ?? p.email}
                        {p.title && <span className="font-normal text-muted-foreground"> · {p.title}</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {p.email} · {p.roleName} · {p.permissions.map((x) => humanize(x).toLowerCase()).join(", ") || "no permissions"}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => { setEditing(editing === p.userId ? null : p.userId); setProfile({ title: p.title ?? "", phone: p.phone ?? "", photoUrl: p.photoUrl ?? "" }); }}>
                        Signature
                      </Button>
                      <Button size="sm" variant="outline" disabled={pending} onClick={() => confirmed(`Reset the password for ${p.name ?? p.email}? They are signed out everywhere and you hand them the new one-time password.`) && run(async () => { const r = await inviteMemberAction(tenant.id, { email: p.email, roleId: p.roleId ?? roles[0]?.id ?? "", resetPassword: true }); if (r.ok && r.temporaryPassword) setReveal({ email: p.email, password: r.temporaryPassword }); return r; })}>
                        <KeyRound /> Reset password
                      </Button>
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => confirmed(`Remove ${p.name ?? p.email} from ${tenant.name}? They lose access immediately.`) && run(() => removeMemberAction(tenant.id, p.userId))}>
                        <Trash2 /> Remove
                      </Button>
                    </div>
                  </div>
                  {editing === p.userId && (
                    <div className="mt-2 grid gap-2 rounded-lg border bg-muted/40 p-4 sm:grid-cols-[1fr_1fr_1.4fr_auto]">
                      <Input placeholder="Job title" value={profile.title} onChange={(e) => setProfile({ ...profile, title: e.target.value })} aria-label="Job title" />
                      <Input placeholder="Mobile" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} aria-label="Mobile" />
                      <Input placeholder="Photo address (https, round PNG)" value={profile.photoUrl} onChange={(e) => setProfile({ ...profile, photoUrl: e.target.value })} aria-label="Photo address" />
                      <Button size="sm" disabled={pending} onClick={() => run(async () => { const r = await updateMemberProfileAction(tenant.id, p.userId, profile); if (r.ok) setEditing(null); return r; })}>
                        Save
                      </Button>
                      <p className="text-xs text-muted-foreground sm:col-span-4">Shown in the email signature when messages are signed as {p.name?.split(" ")[0] ?? "this person"}.</p>
                    </div>
                  )}
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
              <select className="h-10 rounded-lg border border-input bg-card px-3 text-sm" value={operatorId} onChange={(e) => setOperatorId(e.target.value)} aria-label="Operator">
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
        </Panel>
</Section>
      <Section id="invite-a-person-title" title="Invite a person" lede="New accounts get a one-time password to hand over privately. They sign in at /login.">
<Panel className="py-5 flex flex-col gap-2">
          {reveal && (
            <div className="rounded-lg border bg-muted p-4 text-sm" role="status">
              <p className="font-medium">{reveal.email}</p>
              <p className="font-mono text-base">{reveal.password}</p>
              <p className="text-xs text-muted-foreground">Shown once and cleared from this screen after two minutes. Hand it over privately and ask them to sign in with Google or change it.</p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(reveal.password).catch(() => {})}>
                  <Copy /> Copy
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setReveal(null)}>
                  Dismiss
                </Button>
              </div>
            </div>
          )}
          <Input type="email" placeholder="Email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} aria-label="Email" />
          <Input placeholder="Name" value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} aria-label="Name" />
          <select className="h-11 rounded-lg border border-input bg-card px-4 text-base" value={invite.roleId} onChange={(e) => setInvite({ ...invite, roleId: e.target.value })} aria-label="Role">
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} — {r.permissions.map((x) => humanize(x).toLowerCase()).join(", ") || "no permissions"}
              </option>
            ))}
          </select>
          <Button disabled={pending || !invite.email.includes("@") || !invite.roleId} onClick={() => run(async () => { const r = await inviteMemberAction(tenant.id, invite); if (r.ok) { if (r.temporaryPassword) setReveal({ email: invite.email, password: r.temporaryPassword }); setInvite({ ...invite, email: "", name: "" }); } return r; })}>
            <UserPlus /> Invite
          </Button>
        </Panel>
</Section>
    </div>
  );
}

function KeysPanel({ tenant, keys, fmt, pending, run }: Props & { pending: boolean; run: Run }) {
  const [label, setLabel] = useState("Website forms");
  const [scopes, setScopes] = useState<{ intake: boolean; content: boolean; webhooks: boolean }>({ intake: true, content: false, webhooks: false });
  const [raw, setRaw] = useState<string | null>(null);
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section id="api-keys-title" title="API keys" lede="Intake keys go in public web forms, call tracking and review feeds. Content keys upload files and material and must stay private.">
<Panel className="py-5">
          {keys.length === 0 ? (
            <p className="py-4 text-base text-muted-foreground">No keys issued yet.</p>
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
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => confirmed(`Revoke "${k.label}"? Any form or connector using it stops working immediately.`) && run(() => revokeApiKeyAction(tenant.id, k.id))}>
                      <Trash2 /> Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
</Section>
      <Section id="issue-a-key-title" title="Issue a key" lede="The key is shown once. Put it in the form as a hidden field or the x-api-key header.">
<Panel className="py-5 flex flex-col gap-2">
          {raw && (
            <div className="rounded-lg border bg-muted p-4">
              <p className="break-all font-mono text-sm">{raw}</p>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => navigator.clipboard?.writeText(raw)}>
                <Copy /> Copy
              </Button>
            </div>
          )}
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" aria-label="Key label" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={scopes.intake} onChange={(e) => setScopes({ ...scopes, intake: e.target.checked })} /> intake (website forms and the page beacon; this one is public)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={scopes.webhooks} onChange={(e) => setScopes({ ...scopes, webhooks: e.target.checked })} /> webhooks (call tracking and review feeds; keep private)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={scopes.content} onChange={(e) => setScopes({ ...scopes, content: e.target.checked })} /> content (uploads and material; keep private)
          </label>
          <Button disabled={pending || (!scopes.intake && !scopes.content && !scopes.webhooks)} onClick={() => run(async () => { const r = await issueApiKeyAction(tenant.id, label, [...(scopes.intake ? ["intake" as const] : []), ...(scopes.content ? ["content" as const] : []), ...(scopes.webhooks ? ["webhooks" as const] : [])]); if (r.ok && r.rawKey) setRaw(r.rawKey); return r; })}>
            <KeyRound /> Issue key
          </Button>
        </Panel>
</Section>
    </div>
  );
}

function SwitchesPanel({ tenant, modules, automations, pending, run }: Props & { pending: boolean; run: Run }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section id="modules-title" title="Modules" lede="What this workspace runs.">
<Panel className="py-5">
          <ul className="divide-y">
            {modules.map((m) => (
              <li key={m.moduleKey} className="flex items-center justify-between gap-2 py-2">
                <div>
                  <p className="text-sm font-medium">{MODULE_BY_KEY[m.moduleKey]?.name ?? m.moduleKey}</p>
                  <p className="text-xs text-muted-foreground">{MODULE_BY_KEY[m.moduleKey]?.description}</p>
                </div>
                <Button size="sm" variant={m.enabled ? "default" : "outline"} disabled={pending} onClick={() => run(() => setModuleAction(tenant.id, m.moduleKey, !m.enabled))}>
                  {m.enabled ? "On" : "Off"}
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
</Section>
      <Section id="automations-title" title="Automations" lede="Each one logs what it did in plain words. Reactivation stays off for real estate unless the client asks.">
<Panel className="py-5">
          <ul className="divide-y">
            {automations.map((a) => (
              <li key={a.typeKey} className="flex items-center justify-between gap-2 py-2">
                <div>
                  <p className="text-sm font-medium">{AUTOMATION_BY_KEY[a.typeKey]?.name ?? a.typeKey}</p>
                  <p className="text-xs text-muted-foreground">{AUTOMATION_BY_KEY[a.typeKey]?.description}</p>
                </div>
                <Button size="sm" variant={a.enabled ? "default" : "outline"} disabled={pending} onClick={() => run(() => setAutomationAction(tenant.id, a.typeKey, !a.enabled))}>
                  {a.enabled ? "On" : "Off"}
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
</Section>
    </div>
  );
}

function EscalationPanel({ tenant, people, fmt, pending, run }: Props & { pending: boolean; run: Run }) {
  const members = people.filter((p) => p.via === "member");
  const [rules, setRules] = useState<Record<string, string>>(Object.fromEntries(tenant.escalationRules.map((r) => [r.when, r.notifyUserId])));
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(OPPORTUNITY_TYPES.map((t) => [t, String((tenant.opportunityValues[t] ?? 0) / 100)])));
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section id="who-at-the-client-hears-about-what-title" title="Who at the client hears about what" lede="By default missed opportunities go to Me² operators. Name a client person here and they are emailed as well.">
<Panel className="py-5 flex flex-col gap-2">
          {members.length === 0 && <p className="text-sm text-muted-foreground">Invite someone from the client first.</p>}
          {["*", ...OPPORTUNITY_TYPES].map((t) => (
            <label key={t} className="flex items-center justify-between gap-2 text-sm">
              <span>{t === "*" ? "Everything" : humanize(t)}</span>
              <select className="h-10 w-56 rounded-lg border border-input bg-card px-3 text-sm" value={rules[t] ?? ""} onChange={(e) => setRules({ ...rules, [t]: e.target.value })}>
                <option value="">Operators only</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name ?? m.email}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <Button disabled={pending} onClick={() => run(() => saveEscalationRulesAction(tenant.id, Object.entries(rules).filter(([, v]) => v).map(([when, notifyUserId]) => ({ when, notifyUserId }))))}>
            <Check /> Save rules
          </Button>
        </Panel>
</Section>
      <Section id="what-a-missed-opportunity-is-worth-title" title="What a missed opportunity is worth" lede={<>In {fmt.currency}. Drives the “money at risk” and “recovered” figures the client sees.</>}>
<Panel className="py-5 flex flex-col gap-2">
          {OPPORTUNITY_TYPES.map((t) => (
            <label key={t} className="flex items-center justify-between gap-2 text-sm">
              <span>{humanize(t)}</span>
              <Input type="number" min={0} className="w-36" value={values[t]} onChange={(e) => setValues({ ...values, [t]: e.target.value })} aria-label={`Value of ${humanize(t)}`} />
            </label>
          ))}
          <Button disabled={pending} onClick={() => run(() => saveOpportunityValuesAction(tenant.id, Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)]))))}>
            <Check /> Save values
          </Button>
        </Panel>
</Section>
    </div>
  );
}

function InventoryPanel({ tenant, inventory, modules, fmt, pending, run }: Props & { pending: boolean; run: Run }) {
  const [csv, setCsv] = useState("");
  const on = modules.find((m) => m.moduleKey === "inventory")?.enabled;
  const money = (c: number | null) => (c === null ? "" : (c / 100).toLocaleString(fmt.locale, { style: "currency", currency: fmt.currency, maximumFractionDigits: 0 }));
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Section id="listings-and-stock-title" title="Listings and stock" lede={<>{on ? "New active listings become content-engine material; an enquiry that names one gets its link in the automatic reply." : "The inventory module is off for this workspace; switch it on under Modules to use this."}</>}>
<Panel className="py-5">
          {inventory.length === 0 ? (
            <p className="py-4 text-base text-muted-foreground">Nothing imported yet.</p>
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
        </Panel>
</Section>
      <Section id="import-from-csv-title" title="Import from CSV" lede="A header row, then one item per line. Columns understood: address or name, status, rent, price, bedrooms, bathrooms, suburb, url, available, reference, quantity.">
<Panel className="py-5 flex flex-col gap-2">
          <Textarea rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={"address,suburb,status,rent,bedrooms,url\n12 Marine Parade,Glenelg,available,620,2,https://…"} aria-label="CSV" />
          <Button disabled={pending || csv.trim().length < 10} onClick={() => run(async () => { const r = await importInventoryAction(tenant.id, csv); if (r.ok) setCsv(""); return r; })}>
            <Upload /> Import
          </Button>
        </Panel>
</Section>
    </div>
  );
}
