"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { provisionTenantAction } from "@/lib/tenants/actions";
import { cn } from "@/lib/utils";

interface Props {
  templates: { key: string; name: string; industry: string }[];
  regions: { region: string; timezone: string; locale: string; currency: string; label: string }[];
}

/** Platform admin: a workspace from a template. Everything here is configuration; nothing client-specific lives in code. */
export function NewWorkspaceForm({ templates, regions }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [form, setForm] = useState({ templateKey: templates[0]?.key ?? "generic", name: "", slug: "", preset: 0, fromName: "", replyTo: "", primaryColor: "", serviceAreas: "", requiredFooter: "" });
  const preset = regions[form.preset] ?? regions[0];
  const isRealEstate = templates.find((t) => t.key === form.templateKey)?.industry === "REAL_ESTATE";

  return (
    <Card aria-labelledby="new-ws-title" className="max-w-2xl">
      <CardHeader>
        <CardTitle id="new-ws-title">New workspace</CardTitle>
        <CardDescription>Pick the industry template, name the business, and set where it is. Everything else is filled in from the template and can be changed in Settings.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {notice && (
          <p role="status" aria-live="polite" className={cn("rounded-md px-3 py-2 text-sm", notice.tone === "ok" ? "bg-green-soft text-green-text" : "bg-red-soft text-red-text")}>
            {notice.text}
          </p>
        )}
        <label className="flex flex-col gap-1 text-sm font-medium">
          Template
          <select className="h-9 rounded-md border bg-background px-3 text-sm font-normal" value={form.templateKey} onChange={(e) => setForm({ ...form, templateKey: e.target.value })}>
            {templates.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Business name
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Harbor Realty Group" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Workspace address (optional)
          <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="letters, numbers and dashes; made from the name if left blank" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Region and timezone
          <select className="h-9 rounded-md border bg-background px-3 text-sm font-normal" value={form.preset} onChange={(e) => setForm({ ...form, preset: Number(e.target.value) })}>
            {regions.map((r, i) => (
              <option key={r.label} value={i}>
                {r.label} · {r.currency}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Sender name on messages
            <Input value={form.fromName} onChange={(e) => setForm({ ...form, fromName: e.target.value })} placeholder="How the business signs texts and emails" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Reply-to email
            <Input type="email" value={form.replyTo} onChange={(e) => setForm({ ...form, replyTo: e.target.value })} placeholder="office@business.example" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Brand colour
            <Input value={form.primaryColor} onChange={(e) => setForm({ ...form, primaryColor: e.target.value })} placeholder="#0f4c81" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Service areas
            <Input value={form.serviceAreas} onChange={(e) => setForm({ ...form, serviceAreas: e.target.value })} placeholder="Adelaide, Glenelg, Mount Gambier" />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Line every asset must carry {isRealEstate ? "(licence number)" : "(optional)"}
          <Input value={form.requiredFooter} onChange={(e) => setForm({ ...form, requiredFooter: e.target.value })} placeholder={isRealEstate ? "Business Name | RLA 000000" : "e.g. ABN or registration line"} />
        </label>
        <Button
          variant="green"
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
      </CardContent>
    </Card>
  );
}
