"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Check, Copy, KeyRound, Trash2, UserPlus, Upload } from "lucide-react";
import { Badge, Count } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckField, Field, FieldGrid } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Row } from "@/components/shell/section";
import { AUTOMATION_BY_KEY } from "@/lib/automations/registry";
import { MODULE_BY_KEY } from "@/lib/modules/registry";
import { assignOperatorAction, importInventoryAction, inviteMemberAction, issueApiKeyAction, removeMemberAction, revokeApiKeyAction, saveEscalationRulesAction, saveOpportunityValuesAction, saveTenantSettingsAction, setAutomationAction, setModuleAction, updateMemberProfileAction } from "@/lib/tenants/actions";
import type { OperatorOption, SettingsView } from "@/lib/tenants/settings-view";
import type { ApiKeyRecord, InventoryItemRecord, ReadinessCheck, TenantAutomationRecord, TenantModuleRecord, TenantPersonRecord, TenantRoleRecord } from "@/lib/types";
import { cn, formatDateTime, humanize, type FormatContext } from "@/lib/utils";

interface Props {
  tenant: SettingsView;
  isAdmin: boolean;
  fmt: FormatContext;
  readiness: ReadinessCheck[];
  platformReadiness: ReadinessCheck[];
  brand: { voice: string | null; bannedPhrases: string[]; requiredFooter: string; claimsPolicy: string };
  roles: TenantRoleRecord[];
  people: TenantPersonRecord[];
  operators: OperatorOption[];
  keys: ApiKeyRecord[];
  modules: TenantModuleRecord[];
  automations: TenantAutomationRecord[];
  inventory: InventoryItemRecord[];
}

type Run = (fn: () => Promise<{ ok: boolean; message: string }>) => void;

/** A second look before something that cannot be undone. */
const confirmed = (question: string) => typeof window === "undefined" || window.confirm(question);

const OPPORTUNITY_TYPES = ["UNANSWERED_ENQUIRY", "MISSED_CALL", "ABANDONED_FORM", "NOT_BOOKED", "NO_SHOW", "QUIET_QUOTE", "UNREPLIED_DM", "UNREPLIED_COMMENT", "UNANSWERED_REVIEW", "LAPSED_CUSTOMER"] as const;

/** One block of settings: a surface card with a title, a line, and its content. */
function Block({ id, title, lede, children, className }: { id: string; title: React.ReactNode; lede?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={cn("surface flex min-w-0 flex-col p-5", className)}>
      <h2 id={id} className="section-title">
        {title}
      </h2>
      {lede && <p className="mt-0.5 text-sm text-muted-foreground">{lede}</p>}
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** The one primary action at the foot of a block. */
function BlockFooter({ children }: { children: React.ReactNode }) {
  return <div className="mt-1 flex flex-wrap justify-end gap-2 border-t pt-4">{children}</div>;
}

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
  const passed = required.filter((c) => c.ok).length;
  const ready = required.every((c) => c.ok);

  return (
    <div className="flex flex-col gap-5">
      <Tabs defaultValue="readiness">
        <TabsList variant="line">
          <TabsTrigger value="readiness">
            Launch readiness {ready ? <Badge variant="green">Ready</Badge> : <Badge variant="amber">{passed}/{required.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="business">Business</TabsTrigger>
          <TabsTrigger value="people">
            People <Count n={props.people.filter((p) => p.via === "member").length} />
          </TabsTrigger>
          <TabsTrigger value="keys">API keys</TabsTrigger>
          <TabsTrigger value="switches">Modules &amp; automations</TabsTrigger>
          <TabsTrigger value="escalation">Escalation &amp; values</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
        </TabsList>
        {notice && (
          <Notice tone={notice.tone} className="mt-5 whitespace-pre-wrap">
            {notice.text}
          </Notice>
        )}
        <TabsContent value="readiness">
          <ReadinessPanel tenant={tenant} checks={readiness} platform={platformReadiness} />
        </TabsContent>
        <TabsContent value="business">
          <BusinessPanel {...props} pending={pending} run={run} />
        </TabsContent>
        <TabsContent value="people">
          <PeoplePanel {...props} pending={pending} run={run} />
        </TabsContent>
        <TabsContent value="keys">
          <KeysPanel {...props} pending={pending} run={run} />
        </TabsContent>
        <TabsContent value="switches">
          <SwitchesPanel {...props} pending={pending} run={run} />
        </TabsContent>
        <TabsContent value="escalation">
          <EscalationPanel {...props} pending={pending} run={run} />
        </TabsContent>
        <TabsContent value="inventory">
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
        <Row key={c.key} className="items-start">
          <div className="min-w-0">
            <p className="text-sm font-medium">{c.label}</p>
            <p className="text-xs text-muted-foreground">{c.detail}</p>
          </div>
          <Badge variant={c.ok ? "green" : c.level === "required" ? "red" : c.level === "recommended" ? "amber" : "muted"}>{c.ok ? "Ready" : c.level === "required" ? "Needed" : c.level === "recommended" ? "Recommended" : "Optional"}</Badge>
        </Row>
      ))}
    </ul>
  );
}

function ReadinessPanel({ tenant, checks, platform }: { tenant: SettingsView; checks: ReadinessCheck[]; platform: ReadinessCheck[] }) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Block id="readiness-ws-title" title={<>{tenant.name}: workspace</>} lede="The success test: every lead answered in minutes, missed opportunities visible, a week of content approvable, ad spend tied to leads.">
        <CheckList checks={checks} />
      </Block>
      <Block id="readiness-platform-title" title="Deployment" lede="Applies to every workspace on this deployment.">
        <CheckList checks={platform} />
      </Block>
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
    <Field label={label}>
      <Input value={String(f[key])} onChange={(e) => setF({ ...f, [key]: e.target.value })} {...props} />
    </Field>
  );
  const area = (label: string, key: keyof typeof f, hint: string) => (
    <Field label={label}>
      <Textarea rows={3} value={String(f[key])} onChange={(e) => setF({ ...f, [key]: e.target.value })} placeholder={hint} />
    </Field>
  );
  const save = (
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
  );
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Block id="business-and-service-levels-title" title="Business and service levels" lede="How messages are signed, how fast leads must be answered, when not to message.">
        {field("Business name", "name")}
        <FieldGrid columns={2}>
          {field("Sender name", "fromName")}
          {field("Reply-to email", "replyTo", { type: "email" })}
          {field("Brand colour", "primaryColor", { placeholder: "#0f4c81" })}
          {field("Service areas (comma separated)", "serviceAreas")}
          {field("First response within (minutes)", "firstResponseMinutes", { type: "number", min: 1 })}
          {field("Booking window (hours)", "bookingWindowHours", { type: "number", min: 1 })}
          {field("Quiet hours start (0–23)", "quietStart", { type: "number", min: 0, max: 23 })}
          {field("Quiet hours end (0–23)", "quietEnd", { type: "number", min: 0, max: 23 })}
        </FieldGrid>
        <CheckField label="Sign messages as the person assigned to the lead" hint="Replies go to them; the business name and number stay the same.">
          <input type="checkbox" checked={f.signAsAssignee} onChange={(e) => setF({ ...f, signAsAssignee: e.target.checked })} />
        </CheckField>
        <div className="flex flex-col gap-4 border-t pt-4">
          <div>
            <h3 className="text-sm font-medium">Email signature</h3>
            <p className="text-xs text-muted-foreground">Logo, contact details and offices shown under every email.</p>
          </div>
          <FieldGrid columns={2}>
            {field("Logo image address (https)", "logoUrl", { placeholder: "https://example.com.au/logo.png" })}
            {field("Website", "website", { placeholder: "example.com.au" })}
            {field("Office phone", "phone", { placeholder: "1300 000 000" })}
            {field("Facebook page", "facebook", { placeholder: "https://www.facebook.com/…" })}
            {field("Instagram profile", "instagram", { placeholder: "https://instagram.com/…" })}
            {field("YouTube channel", "youtube", { placeholder: "https://www.youtube.com/@…" })}
          </FieldGrid>
          {area("Offices (one per line)", "addresses", "Adelaide: Level 1 / 1 Example Rd, Suburb\nMount Gambier: 1 Example St")}
        </div>
        <BlockFooter>{save}</BlockFooter>
      </Block>
      <Block id="qualification-brand-and-compliance-title" title="Qualification, brand and compliance" lede="Read by the lead qualifier and enforced on every piece of content.">
        {area("What makes a lead worth a person's time (one per line)", "greenCriteria", "wants an appraisal\nowner of an investment property")}
        {area("Enquiries handled automatically (one per line)", "autoHandled", "rental availability questions\ninvoice and supplier emails")}
        {field("Services people ask for (comma separated)", "highIntentServices", { placeholder: "appraisal, property management" })}
        <CheckField label="A phone number is required for a lead to need a person">
          <input type="checkbox" checked={f.requirePhone} onChange={(e) => setF({ ...f, requirePhone: e.target.checked })} />
        </CheckField>
        {area("Brand voice", "voice", "Local, knowledgeable and calm. Plain English.")}
        {field("Banned phrases (comma separated)", "bannedPhrases")}
        {field("Line every email and asset must carry", "requiredFooter", { placeholder: "Business Name | Licence 000000" })}
        {field("Claims policy", "claimsPolicy", { placeholder: "Only state prices and figures from a record on file." })}
        <BlockFooter>{save}</BlockFooter>
      </Block>
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
    <div className="grid gap-6 xl:grid-cols-2">
      <Block id="people-at-title" title={<>People at {tenant.name}</>} lede="Roles decide what each person sees: finances, approvals, lead alerts, user management, all records or own.">
        {members.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">Nobody from the client yet.</p>
        ) : (
          <ul className="divide-y">
            {members.map((p) => (
              <li key={p.userId} className="py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {p.name ?? p.email}
                      {p.title && <span className="font-normal text-muted-foreground"> · {p.title}</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {p.email} · {p.roleName} · {p.permissions.map((x) => humanize(x).toLowerCase()).join(", ") || "no permissions"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => { setEditing(editing === p.userId ? null : p.userId); setProfile({ title: p.title ?? "", phone: p.phone ?? "", photoUrl: p.photoUrl ?? "" }); }}>
                      Signature
                    </Button>
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => confirmed(`Reset the password for ${p.name ?? p.email}? They are signed out everywhere and you hand them the new one-time password.`) && run(async () => { const r = await inviteMemberAction(tenant.id, { email: p.email, roleId: p.roleId ?? roles[0]?.id ?? "", resetPassword: true }); if (r.ok && r.temporaryPassword) setReveal({ email: p.email, password: r.temporaryPassword }); return r; })}>
                      <KeyRound /> Reset password
                    </Button>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => confirmed(`Remove ${p.name ?? p.email} from ${tenant.name}? They lose access immediately.`) && run(() => removeMemberAction(tenant.id, p.userId))}>
                      <Trash2 className="text-red-text" /> Remove
                    </Button>
                  </div>
                </div>
                {editing === p.userId && (
                  <div className="mt-3 flex flex-col gap-3 rounded-md bg-muted/60 p-4">
                    <FieldGrid columns={3}>
                      <Field label="Job title">
                        <Input placeholder="Job title" value={profile.title} onChange={(e) => setProfile({ ...profile, title: e.target.value })} aria-label="Job title" />
                      </Field>
                      <Field label="Mobile">
                        <Input placeholder="Mobile" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} aria-label="Mobile" />
                      </Field>
                      <Field label="Photo address">
                        <Input placeholder="Photo address (https, round PNG)" value={profile.photoUrl} onChange={(e) => setProfile({ ...profile, photoUrl: e.target.value })} aria-label="Photo address" />
                      </Field>
                    </FieldGrid>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs text-muted-foreground">Shown in the email signature when messages are signed as {p.name?.split(" ")[0] ?? "this person"}.</p>
                      <Button size="sm" disabled={pending} onClick={() => run(async () => { const r = await updateMemberProfileAction(tenant.id, p.userId, profile); if (r.ok) setEditing(null); return r; })}>
                        Save
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-2 border-t pt-4">
          <h3 className="text-sm font-medium">Me² operators</h3>
          <ul className="divide-y">
            {assigned.map((p) => (
              <li key={p.userId} className="py-2 text-sm">
                {p.name ?? p.email} <span className="text-muted-foreground">· {p.email}</span>
              </li>
            ))}
            {assigned.length === 0 && <li className="py-2 text-sm text-muted-foreground">No operator assigned (platform admins always have access).</li>}
          </ul>
          {isAdmin && operators.length > 0 && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Select className="sm:max-w-xs" value={operatorId} onChange={(e) => setOperatorId(e.target.value)} aria-label="Operator">
                {operators.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name ?? o.email}
                  </option>
                ))}
              </Select>
              <Button size="sm" variant="outline" disabled={pending || !operatorId} onClick={() => run(() => assignOperatorAction(tenant.id, operatorId))}>
                Assign operator
              </Button>
            </div>
          )}
        </div>
      </Block>
      <Block id="invite-a-person-title" title="Invite a person" lede="New accounts get a one-time password to hand over privately. They sign in at /login." className="self-start">
        {reveal && (
          <div className="rounded-md bg-muted p-4 text-sm" role="status">
            <p className="font-medium">{reveal.email}</p>
            <p className="font-mono text-md">{reveal.password}</p>
            <p className="text-xs text-muted-foreground">Shown once and cleared from this screen after two minutes. Hand it over privately and ask them to sign in with Google or change it.</p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(reveal.password).catch(() => {})}>
                <Copy /> Copy
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setReveal(null)}>
                Dismiss
              </Button>
            </div>
          </div>
        )}
        <Field label="Email">
          <Input type="email" placeholder="Email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} aria-label="Email" />
        </Field>
        <Field label="Name">
          <Input placeholder="Name" value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} aria-label="Name" />
        </Field>
        <Field label="Role">
          <Select value={invite.roleId} onChange={(e) => setInvite({ ...invite, roleId: e.target.value })} aria-label="Role">
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} — {r.permissions.map((x) => humanize(x).toLowerCase()).join(", ") || "no permissions"}
              </option>
            ))}
          </Select>
        </Field>
        <BlockFooter>
          <Button disabled={pending || !invite.email.includes("@") || !invite.roleId} onClick={() => run(async () => { const r = await inviteMemberAction(tenant.id, invite); if (r.ok) { if (r.temporaryPassword) setReveal({ email: invite.email, password: r.temporaryPassword }); setInvite({ ...invite, email: "", name: "" }); } return r; })}>
            <UserPlus /> Invite
          </Button>
        </BlockFooter>
      </Block>
    </div>
  );
}

function KeysPanel({ tenant, keys, fmt, pending, run }: Props & { pending: boolean; run: Run }) {
  const [label, setLabel] = useState("Website forms");
  const [scopes, setScopes] = useState<{ intake: boolean; content: boolean; webhooks: boolean }>({ intake: true, content: false, webhooks: false });
  const [raw, setRaw] = useState<string | null>(null);
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Block id="api-keys-title" title="API keys" lede="Intake keys go in public web forms, call tracking and review feeds. Content keys upload files and material and must stay private.">
        {keys.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">No keys issued yet.</p>
        ) : (
          <ul className="divide-y">
            {keys.map((k) => (
              <Row key={k.id}>
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
                    <Trash2 className="text-red-text" /> Revoke
                  </Button>
                )}
              </Row>
            ))}
          </ul>
        )}
      </Block>
      <Block id="issue-a-key-title" title="Issue a key" lede="The key is shown once. Put it in the form as a hidden field or the x-api-key header." className="self-start">
        {raw && (
          <div className="rounded-md bg-muted p-4">
            <p className="break-all font-mono text-sm">{raw}</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => navigator.clipboard?.writeText(raw)}>
              <Copy /> Copy
            </Button>
          </div>
        )}
        <Field label="Label">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" aria-label="Key label" />
        </Field>
        <div className="flex flex-col gap-3">
          <CheckField label="intake" hint="Website forms and the page beacon; this one is public.">
            <input type="checkbox" checked={scopes.intake} onChange={(e) => setScopes({ ...scopes, intake: e.target.checked })} />
          </CheckField>
          <CheckField label="webhooks" hint="Call tracking and review feeds; keep private.">
            <input type="checkbox" checked={scopes.webhooks} onChange={(e) => setScopes({ ...scopes, webhooks: e.target.checked })} />
          </CheckField>
          <CheckField label="content" hint="Uploads and material; keep private.">
            <input type="checkbox" checked={scopes.content} onChange={(e) => setScopes({ ...scopes, content: e.target.checked })} />
          </CheckField>
        </div>
        <BlockFooter>
          <Button disabled={pending || (!scopes.intake && !scopes.content && !scopes.webhooks)} onClick={() => run(async () => { const r = await issueApiKeyAction(tenant.id, label, [...(scopes.intake ? ["intake" as const] : []), ...(scopes.content ? ["content" as const] : []), ...(scopes.webhooks ? ["webhooks" as const] : [])]); if (r.ok && r.rawKey) setRaw(r.rawKey); return r; })}>
            <KeyRound /> Issue key
          </Button>
        </BlockFooter>
      </Block>
    </div>
  );
}

function SwitchesPanel({ tenant, modules, automations, pending, run }: Props & { pending: boolean; run: Run }) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Block id="modules-title" title="Modules" lede="What this workspace runs.">
        <ul className="divide-y">
          {modules.map((m) => (
            <Row key={m.moduleKey}>
              <div className="min-w-0">
                <p className="text-sm font-medium">{MODULE_BY_KEY[m.moduleKey]?.name ?? m.moduleKey}</p>
                <p className="text-xs text-muted-foreground">{MODULE_BY_KEY[m.moduleKey]?.description}</p>
              </div>
              <Button size="sm" variant={m.enabled ? "default" : "outline"} disabled={pending} onClick={() => run(() => setModuleAction(tenant.id, m.moduleKey, !m.enabled))}>
                {m.enabled ? "On" : "Off"}
              </Button>
            </Row>
          ))}
        </ul>
      </Block>
      <Block id="automations-title" title="Automations" lede="Each one logs what it did in plain words. Reactivation stays off for real estate unless the client asks.">
        <ul className="divide-y">
          {automations.map((a) => (
            <Row key={a.typeKey}>
              <div className="min-w-0">
                <p className="text-sm font-medium">{AUTOMATION_BY_KEY[a.typeKey]?.name ?? a.typeKey}</p>
                <p className="text-xs text-muted-foreground">{AUTOMATION_BY_KEY[a.typeKey]?.description}</p>
              </div>
              <Button size="sm" variant={a.enabled ? "default" : "outline"} disabled={pending} onClick={() => run(() => setAutomationAction(tenant.id, a.typeKey, !a.enabled))}>
                {a.enabled ? "On" : "Off"}
              </Button>
            </Row>
          ))}
        </ul>
      </Block>
    </div>
  );
}

function EscalationPanel({ tenant, people, fmt, pending, run }: Props & { pending: boolean; run: Run }) {
  const members = people.filter((p) => p.via === "member");
  const [rules, setRules] = useState<Record<string, string>>(Object.fromEntries(tenant.escalationRules.map((r) => [r.when, r.notifyUserId])));
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(OPPORTUNITY_TYPES.map((t) => [t, String((tenant.opportunityValues[t] ?? 0) / 100)])));
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Block id="who-at-the-client-hears-about-what-title" title="Who at the client hears about what" lede="By default missed opportunities go to Me² operators. Name a client person here and they are emailed as well.">
        {members.length === 0 && <p className="text-sm text-muted-foreground">Invite someone from the client first.</p>}
        <ul className="divide-y">
          {["*", ...OPPORTUNITY_TYPES].map((t) => (
            <li key={t}>
              <label className="flex items-center justify-between gap-4 py-2.5 text-sm">
                <span className="min-w-0 truncate">{t === "*" ? "Everything" : humanize(t)}</span>
                <Select className="w-56 shrink-0" value={rules[t] ?? ""} onChange={(e) => setRules({ ...rules, [t]: e.target.value })}>
                  <option value="">Operators only</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name ?? m.email}
                    </option>
                  ))}
                </Select>
              </label>
            </li>
          ))}
        </ul>
        <BlockFooter>
          <Button disabled={pending} onClick={() => run(() => saveEscalationRulesAction(tenant.id, Object.entries(rules).filter(([, v]) => v).map(([when, notifyUserId]) => ({ when, notifyUserId }))))}>
            <Check /> Save rules
          </Button>
        </BlockFooter>
      </Block>
      <Block id="what-a-missed-opportunity-is-worth-title" title="What a missed opportunity is worth" lede={<>In {fmt.currency}. Drives the “money at risk” and “recovered” figures the client sees.</>}>
        <ul className="divide-y">
          {OPPORTUNITY_TYPES.map((t) => (
            <li key={t}>
              <label className="flex items-center justify-between gap-4 py-2.5 text-sm">
                <span className="min-w-0 truncate">{humanize(t)}</span>
                <Input type="number" min={0} className="w-36 shrink-0" value={values[t]} onChange={(e) => setValues({ ...values, [t]: e.target.value })} aria-label={`Value of ${humanize(t)}`} />
              </label>
            </li>
          ))}
        </ul>
        <BlockFooter>
          <Button disabled={pending} onClick={() => run(() => saveOpportunityValuesAction(tenant.id, Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)]))))}>
            <Check /> Save values
          </Button>
        </BlockFooter>
      </Block>
    </div>
  );
}

function InventoryPanel({ tenant, inventory, modules, fmt, pending, run }: Props & { pending: boolean; run: Run }) {
  const [csv, setCsv] = useState("");
  const on = modules.find((m) => m.moduleKey === "inventory")?.enabled;
  const money = (c: number | null) => (c === null ? "" : (c / 100).toLocaleString(fmt.locale, { style: "currency", currency: fmt.currency, maximumFractionDigits: 0 }));
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Block id="listings-and-stock-title" title="Listings and stock" lede={<>{on ? "New active listings become content-engine material; an enquiry that names one gets its link in the automatic reply." : "The inventory module is off for this workspace; switch it on under Modules to use this."}</>}>
        {inventory.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">Nothing imported yet.</p>
        ) : (
          <ul className="divide-y">
            {inventory.slice(0, 30).map((i) => (
              <Row key={i.id}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{i.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {humanize(i.type)}
                    {typeof i.attributes.suburb === "string" ? ` · ${i.attributes.suburb}` : ""}
                    {typeof i.attributes.rentPerWeekCents === "number" ? ` · ${money(i.attributes.rentPerWeekCents)}/wk` : i.valueCents ? ` · ${money(i.valueCents)}` : ""}
                  </p>
                </div>
                <Badge variant={i.status === "ACTIVE" ? "green" : i.status === "LOW" ? "amber" : "muted"}>{humanize(i.status)}</Badge>
              </Row>
            ))}
          </ul>
        )}
      </Block>
      <Block id="import-from-csv-title" title="Import from CSV" lede="A header row, then one item per line. Columns understood: address or name, status, rent, price, bedrooms, bathrooms, suburb, url, available, reference, quantity." className="self-start">
        <Field label="CSV">
          <Textarea rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={"address,suburb,status,rent,bedrooms,url\n12 Marine Parade,Glenelg,available,620,2,https://…"} aria-label="CSV" className="font-mono text-xs" />
        </Field>
        <BlockFooter>
          <Button disabled={pending || csv.trim().length < 10} onClick={() => run(async () => { const r = await importInventoryAction(tenant.id, csv); if (r.ok) setCsv(""); return r; })}>
            <Upload /> Import
          </Button>
        </BlockFooter>
      </Block>
    </div>
  );
}
