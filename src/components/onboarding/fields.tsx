"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { emptyTeamRow, TEAM_PERMISSIONS, type Choice, type Field, type OnboardingAnswers, type TaskRow, type TeamRow, type ToolRow } from "@/lib/onboarding/form";
import { cn } from "@/lib/utils";

/**
 * The inputs for every kind of onboarding field, shared by the client's form
 * and the operator's call sheet. `audience` picks the wording: the client
 * reads "Your email", the operator reads "Contact's email".
 */

export type Audience = "client" | "operator";
type OnChange = (key: string, value: OnboardingAnswers[string]) => void;

const selectClass = "h-11 w-full rounded-lg border border-input bg-card px-4 text-base text-foreground outline-none hover:border-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

const labelFor = (field: Field, audience: Audience) => (audience === "operator" ? (field.callLabel ?? field.label) : field.label);

function Required({ field, audience }: { field: Field; audience: Audience }) {
  return field.required && audience === "client" ? <span className="text-muted-foreground"> (required)</span> : null;
}

function FieldShell({ field, audience, htmlFor, children }: { field: Field; audience: Audience; htmlFor?: string; children: React.ReactNode }) {
  const Label = htmlFor ? "label" : "p";
  return (
    <div className="flex flex-col gap-2">
      <Label {...(htmlFor ? { htmlFor } : {})} className="text-sm font-medium">
        {labelFor(field, audience)}
        <Required field={field} audience={audience} />
      </Label>
      {field.hint && (
        <p id={`${field.key}-hint`} className="-mt-1 text-sm text-muted-foreground">
          {field.hint}
        </p>
      )}
      {children}
    </div>
  );
}

function Group({ field, audience, children }: { field: Field; audience: Audience; children: React.ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2" aria-describedby={field.hint ? `${field.key}-hint` : undefined}>
      <legend className="mb-1 text-sm font-medium">
        {labelFor(field, audience)}
        <Required field={field} audience={audience} />
      </legend>
      {field.hint && (
        <p id={`${field.key}-hint`} className="mb-1 text-sm text-muted-foreground">
          {field.hint}
        </p>
      )}
      {children}
    </fieldset>
  );
}

export function FieldInput({ field, answers, onChange, audience = "client" }: { field: Field; answers: OnboardingAnswers; onChange: OnChange; audience?: Audience }) {
  const id = `f-${field.key}`;
  const value = answers[field.key];
  const str = typeof value === "string" ? value : "";
  const describedBy = field.hint ? `${field.key}-hint` : undefined;

  switch (field.kind) {
    case "text":
    case "email":
    case "tel":
    case "url":
    case "number":
    case "date":
      return (
        <FieldShell field={field} audience={audience} htmlFor={id}>
          <Input
            id={id}
            type={field.kind === "number" || field.kind === "url" ? "text" : field.kind}
            inputMode={field.kind === "number" ? "decimal" : field.kind === "url" ? "url" : undefined}
            autoComplete={audience !== "client" ? "off" : field.key === "contactEmail" ? "email" : field.key === "contactName" ? "name" : field.key === "contactMobile" ? "tel" : undefined}
            value={str}
            maxLength={field.maxLength ?? 300}
            placeholder={field.placeholder}
            aria-describedby={describedBy}
            aria-required={field.required || undefined}
            onChange={(e) => onChange(field.key, e.target.value)}
          />
        </FieldShell>
      );
    case "textarea":
      return (
        <FieldShell field={field} audience={audience} htmlFor={id}>
          <Textarea id={id} rows={3} className="min-h-24" value={str} maxLength={field.maxLength ?? 3000} placeholder={field.placeholder} aria-describedby={describedBy} onChange={(e) => onChange(field.key, e.target.value)} />
        </FieldShell>
      );
    case "select":
      return (
        <FieldShell field={field} audience={audience} htmlFor={id}>
          <select id={id} className={selectClass} value={str} aria-describedby={describedBy} aria-required={field.required || undefined} onChange={(e) => onChange(field.key, e.target.value)}>
            <option value="">{field.placeholder ?? "Choose one"}</option>
            {field.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </FieldShell>
      );
    case "choice":
      return (
        <Group field={field} audience={audience}>
          <Pills name={id} options={field.options} value={str} onChange={(v) => onChange(field.key, v)} />
        </Group>
      );
    case "cards":
      return (
        <Group field={field} audience={audience}>
          <div role="radiogroup" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {field.options.map((o) => (
              <label key={o.value} className="relative flex">
                <input type="radio" name={id} value={o.value} checked={str === o.value} onChange={() => onChange(field.key, o.value)} className="peer sr-only" />
                <span className="flex w-full cursor-pointer flex-col justify-center gap-0.5 rounded-xl border border-border px-3 py-2.5 text-sm sm:px-3.5 sm:py-3 transition-colors hover:border-foreground peer-checked:border-foreground peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring">
                  <span className="font-medium">{o.label}</span>
                  {o.hint && <span className="hidden opacity-70 sm:block">{o.hint}</span>}
                </span>
              </label>
            ))}
          </div>
        </Group>
      );
    case "checks": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <Group field={field} audience={audience}>
          <div className="flex flex-wrap gap-2">
            {field.options.map((o) => {
              const on = selected.includes(o);
              return (
                <label key={o} className="relative">
                  <input type="checkbox" className="peer sr-only" checked={on} onChange={(e) => onChange(field.key, e.target.checked ? [...selected, o] : selected.filter((x) => x !== o))} />
                  <span className="inline-flex min-h-10 cursor-pointer items-center rounded-full border border-border px-3.5 py-2 text-sm transition-colors hover:border-foreground peer-checked:border-foreground peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring">{o}</span>
                </label>
              );
            })}
          </div>
        </Group>
      );
    }
    case "confirm":
      return <CheckRow label={labelFor(field, audience)} checked={str === "yes"} onChange={(on) => onChange(field.key, on ? "yes" : "")} />;
    case "team":
      return <TeamEditor rows={(value as TeamRow[] | undefined) ?? []} onChange={(rows) => onChange(field.key, rows)} />;
    case "teamSelect": {
      const team = ((answers.team as TeamRow[] | undefined) ?? []).filter((r) => r.email.trim());
      return (
        <FieldShell field={field} audience={audience} htmlFor={id}>
          <select id={id} className={selectClass} value={str} aria-describedby={describedBy} onChange={(e) => onChange(field.key, e.target.value)}>
            <option value="">{team.length ? "Choose a person" : "Add people above first"}</option>
            {team.map((r) => (
              <option key={r.email} value={r.email}>
                {r.name || r.email}
              </option>
            ))}
          </select>
        </FieldShell>
      );
    }
    case "channels": {
      const rows = (value as Record<string, string> | undefined) ?? {};
      return (
        <Group field={field} audience={audience}>
          {field.options.map((o) => {
            const on = o in rows;
            return (
              <div key={o} className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5">
                <label className="flex min-w-0 flex-1 items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 shrink-0 accent-[var(--primary)]"
                    checked={on}
                    onChange={(e) => {
                      const next = { ...rows };
                      if (e.target.checked) next[o] = next[o] ?? "";
                      else delete next[o];
                      onChange(field.key, next);
                    }}
                  />
                  {o}
                </label>
                {on && <Input aria-label={`${o}: enquiries a month`} className="h-9 w-28 px-3" inputMode="numeric" placeholder="per month" value={rows[o]} maxLength={20} onChange={(e) => onChange(field.key, { ...rows, [o]: e.target.value })} />}
              </div>
            );
          })}
        </Group>
      );
    }
    case "tasks": {
      const rows = (value as Record<string, TaskRow> | undefined) ?? {};
      const set = (task: string, patch: Partial<TaskRow>) => onChange(field.key, { ...rows, [task]: { ...(rows[task] ?? { hours: "", hand: "" }), ...patch } });
      return (
        <Group field={field} audience={audience}>
          {field.options.map((task) => (
            <div key={task} className="flex flex-col gap-2 rounded-lg border px-3 py-3 sm:flex-row sm:items-center">
              <span className="flex-1 text-sm">{task}</span>
              <div className="flex flex-wrap items-center gap-2">
                <Input aria-label={`${task}: hours a week`} className="h-9 w-24 px-3" inputMode="decimal" placeholder="hrs/wk" maxLength={20} value={rows[task]?.hours ?? ""} onChange={(e) => set(task, { hours: e.target.value })} />
                <Pills name={`task-${task}`} compact ariaLabel={`Hand ${task} to Me²?`} options={[{ value: "Yes", label: "Hand over" }, { value: "Maybe", label: "Maybe" }, { value: "No", label: "Keep" }]} value={rows[task]?.hand ?? ""} onChange={(v) => set(task, { hand: v as Choice })} />
              </div>
            </div>
          ))}
        </Group>
      );
    }
    case "tools": {
      const rows = (value as Record<string, ToolRow> | undefined) ?? {};
      const set = (area: string, patch: Partial<ToolRow>) => onChange(field.key, { ...rows, [area]: { ...(rows[area] ?? { tool: "", access: "" }), ...patch } });
      return (
        <Group field={field} audience={audience}>
          {field.options.map(({ area, placeholder }) => (
            <div key={area} className="flex flex-col gap-2 rounded-lg border px-3 py-3 sm:flex-row sm:items-center">
              <span className="text-sm sm:w-48 sm:shrink-0">{area}</span>
              <Input aria-label={`${area}: tool`} className="h-9 sm:flex-1" placeholder={placeholder} maxLength={200} value={rows[area]?.tool ?? ""} onChange={(e) => set(area, { tool: e.target.value })} />
              <Pills name={`tool-${area}`} compact ariaLabel={`Access to the ${area.toLowerCase()} tool`} options={[{ value: "Yes", label: "Access OK" }, { value: "Maybe", label: "Maybe" }, { value: "No", label: "No" }]} value={rows[area]?.access ?? ""} onChange={(v) => set(area, { access: v as Choice })} />
            </div>
          ))}
        </Group>
      );
    }
  }
}

export function Pills({ name, options, value, onChange, compact, ariaLabel }: { name: string; options: { value: string; label: string }[]; value: string; onChange: (v: string) => void; compact?: boolean; ariaLabel?: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <label key={o.value} className="relative">
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} onClick={() => value === o.value && onChange("")} className="peer sr-only" />
          <span className={cn("inline-flex cursor-pointer items-center rounded-full border border-border text-foreground transition-colors hover:border-foreground peer-checked:border-foreground peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring", compact ? "h-9 px-3 text-sm" : "h-11 px-4 text-sm")}>{o.label}</span>
        </label>
      ))}
    </div>
  );
}

export function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:border-foreground", checked && "border-foreground")}>
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function TeamEditor({ rows, onChange }: { rows: TeamRow[]; onChange: (rows: TeamRow[]) => void }) {
  const set = (i: number, patch: Partial<TeamRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="flex flex-col gap-4">
      {rows.map((row, i) => (
        <div key={i} className="flex flex-col gap-4 rounded-xl border p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">{row.name.trim() || `Person ${i + 1}`}</p>
            {rows.length > 1 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Remove ${row.name || `person ${i + 1}`}`}>
                <Trash2 aria-hidden /> Remove
              </Button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Name
              <Input value={row.name} maxLength={120} onChange={(e) => set(i, { name: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Job title
              <Input value={row.title} maxLength={120} onChange={(e) => set(i, { title: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Email
              <Input type="email" value={row.email} maxLength={200} onChange={(e) => set(i, { email: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Mobile
              <Input type="tel" value={row.mobile} maxLength={40} onChange={(e) => set(i, { mobile: e.target.value })} />
            </label>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">What can they do?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {TEAM_PERMISSIONS.map((p) => (
                <label key={p.key} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:border-foreground", row[p.key] && "border-foreground")}>
                  <input type="checkbox" role="switch" aria-checked={row[p.key]} className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" checked={row[p.key]} onChange={(e) => set(i, { [p.key]: e.target.checked })} />
                  <span className="flex flex-col">
                    <span>{p.label}</span>
                    <span className="text-muted-foreground">{p.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      ))}
      <Button type="button" variant="outline" className="self-start" onClick={() => onChange([...rows, emptyTeamRow()])} disabled={rows.length >= 30}>
        <Plus aria-hidden /> Add a person
      </Button>
    </div>
  );
}
