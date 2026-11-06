"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldGrid } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import { TemplatePicker, type TemplateChoice } from "@/components/console/template-picker";
import { provisionTenantAction } from "@/lib/tenants/actions";

interface Props {
  templates: TemplateChoice[];
  regions: { region: string; timezone: string; locale: string; currency: string; label: string }[];
}

/** Platform admin: a workspace from a template. Everything here is configuration; nothing client-specific lives in code. */
export function NewWorkspaceForm({ templates, regions }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [form, setForm] = useState({ templateKey: templates[0]?.key ?? "generic", name: "", slug: "", preset: 0, fromName: "", replyTo: "", primaryColor: "", serviceAreas: "", requiredFooter: "" });
  const preset = regions[form.preset] ?? regions[0];
  const licence = templates.find((t) => t.key === form.templateKey)?.licence;

  return (
    <section aria-labelledby="new-ws-title" className="surface flex w-full max-w-3xl flex-col p-5 sm:p-6">
      <h2 id="new-ws-title" className="section-title">
        New workspace
      </h2>
      <p className="mt-0.5 text-sm text-muted-foreground">Pick the closest kind of business, name it, and set where it is. Everything else is filled in from the template and can be changed in Settings.</p>
      <div className="mt-5 flex flex-col gap-4">
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        <TemplatePicker templates={templates} value={form.templateKey} onChange={(templateKey) => setForm({ ...form, templateKey })} />
        <Field label="Business name">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Harbor Plumbing" />
        </Field>
        <Field label="Workspace address (optional)" hint="Letters, numbers and dashes; made from the name if left blank.">
          <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="letters, numbers and dashes; made from the name if left blank" />
        </Field>
        <Field label="Region and timezone">
          <Select value={form.preset} onChange={(e) => setForm({ ...form, preset: Number(e.target.value) })}>
            {regions.map((r, i) => (
              <option key={r.label} value={i}>
                {r.label} · {r.currency}
              </option>
            ))}
          </Select>
        </Field>
        <FieldGrid columns={2}>
          <Field label="Sender name on messages">
            <Input value={form.fromName} onChange={(e) => setForm({ ...form, fromName: e.target.value })} placeholder="How the business signs texts and emails" />
          </Field>
          <Field label="Reply-to email">
            <Input type="email" value={form.replyTo} onChange={(e) => setForm({ ...form, replyTo: e.target.value })} placeholder="office@business.example" />
          </Field>
          <Field label="Brand colour">
            <Input value={form.primaryColor} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} placeholder="#0f4c81" />
          </Field>
          <Field label="Service areas">
            <Input value={form.serviceAreas} onChange={(e) => setForm({ ...form, serviceAreas: e.target.value })} placeholder="Adelaide, Glenelg, Mount Gambier" />
          </Field>
        </FieldGrid>
        <Field label={`${licence?.label ?? "Registration line"} on every asset ${licence?.required ? "(required before launch)" : "(optional)"}`}>
          <Input value={form.requiredFooter} onChange={(e) => setForm({ ...form, requiredFooter: e.target.value })} placeholder={licence?.placeholder ?? "e.g. ABN or registration line"} />
        </Field>
        <div className="mt-1 flex justify-end border-t pt-4">
          <Button
            disabled={pending || form.name.trim().length < 2}
            onClick={() =>
              start(async () => {
                const r = await provisionTenantAction({ templateKey: form.templateKey, name: form.name, slug: form.slug || undefined, region: preset.region, timezone: preset.timezone, locale: preset.locale, currency: preset.currency, fromName: form.fromName || undefined, replyTo: form.replyTo || "", primaryColor: form.primaryColor || "", serviceAreas: form.serviceAreas || undefined, requiredFooter: form.requiredFooter || undefined });
                setNotice({ tone: r.ok ? "ok" : "error", text: r.message });
                if (r.ok && r.slug) router.push(`/console/${r.slug}/settings`);
              })
            }
          >
            Create workspace
          </Button>
        </div>
      </div>
    </section>
  );
}
