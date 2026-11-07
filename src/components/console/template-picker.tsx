"use client";

import { useId, useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface TemplateChoice {
  key: string;
  name: string;
  group: string;
  examples: string;
  summary: string;
  stages: string[];
  postsPerWeek: number;
  firstResponseMinutes: number;
  licence?: { required: boolean; label: string; placeholder: string };
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** A word matches on its stem, so "plumber" finds "Plumbing" and "dentist" finds "dentists". */
function matches(t: TemplateChoice, query: string): boolean {
  const hay = fold(`${t.name} ${t.group} ${t.examples}`);
  return fold(query)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .every((w) => hay.includes(w.length > 5 ? w.slice(0, w.length - 3) : w));
}

interface Props {
  templates: TemplateChoice[];
  value: string;
  onChange: (key: string) => void;
}

/** Every industry template as a card, grouped and searchable, with what the chosen one sets up. */
export function TemplatePicker({ templates, value, onChange }: Props) {
  const name = useId();
  const [query, setQuery] = useState("");
  const shown = useMemo(() => (query.trim() ? templates.filter((t) => matches(t, query)) : templates), [templates, query]);
  const groups = useMemo(() => {
    const out: { group: string; items: TemplateChoice[] }[] = [];
    for (const t of shown) {
      const g = out.find((x) => x.group === t.group);
      if (g) g.items.push(t);
      else out.push({ group: t.group, items: [t] });
    }
    return out;
  }, [shown]);
  const selected = templates.find((t) => t.key === value) ?? templates[0];

  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-1.5 text-xs font-medium text-foreground">What kind of business?</legend>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search: plumber, dentist, café, broker…" className="pl-9" aria-label="Search templates" />
      </div>

      {groups.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">
          No template fits &ldquo;{query.trim()}&rdquo;.{" "}
          <button type="button" className="font-medium text-foreground underline underline-offset-4" onClick={() => (onChange("generic"), setQuery(""))}>
            Use General business
          </button>
          , which works for anything and can be tuned in Settings.
        </p>
      ) : (
        <div className="-mx-1 flex max-h-[26rem] flex-col gap-4 overflow-y-auto px-1 py-1">
          {groups.map((g) => (
            <div key={g.group} className="flex flex-col gap-2">
              <p className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">{g.group}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {g.items.map((t) => (
                  <label
                    key={t.key}
                    className={cn(
                      "group relative flex cursor-pointer flex-col gap-0.5 rounded-lg border bg-card px-3.5 py-3 shadow-[0_1px_2px_#1b232c0a] transition-[border-color,box-shadow,background-color] hover:border-border-strong",
                      "has-[:checked]:border-brand has-[:checked]:bg-brand/[0.04] has-[:checked]:shadow-[0_0_0_3px_color-mix(in_oklab,var(--brand)_14%,transparent)] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
                    )}
                  >
                    <input type="radio" name={name} value={t.key} checked={value === t.key} onChange={() => onChange(t.key)} className="sr-only" />
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <span className="size-2 shrink-0 rounded-[2px] bg-border-strong transition-colors group-has-[:checked]:bg-brand" aria-hidden="true" />
                      {t.name}
                    </span>
                    <span className="line-clamp-2 pl-4 text-xs text-muted-foreground">{t.examples}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div className="rounded-lg border bg-accent/50 px-4 py-3.5" aria-live="polite">
          <p className="text-sm font-medium">{selected.name}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{selected.summary}</p>
          <ol className="mt-3 flex flex-wrap items-center gap-y-1.5 text-xs" aria-label="Pipeline stages">
            {selected.stages.map((s, i) => (
              <li key={s} className="flex items-center">
                {i > 0 && <ChevronRight className="mx-0.5 size-3.5 text-muted-foreground" aria-hidden="true" />}
                <span className="rounded-full border bg-card px-2 py-0.5">{s}</span>
              </li>
            ))}
          </ol>
          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            <div className="flex gap-1">
              <dt>First reply within</dt>
              <dd className="font-medium text-foreground">{selected.firstResponseMinutes} min</dd>
            </div>
            <div className="flex gap-1">
              <dt>Posts</dt>
              <dd className="font-medium text-foreground">{selected.postsPerWeek} a week</dd>
            </div>
            <div className="flex gap-1">
              <dt>Licence line</dt>
              <dd className="font-medium text-foreground">{selected.licence?.required ? "Required" : "Optional"}</dd>
            </div>
          </dl>
        </div>
      )}
    </fieldset>
  );
}
