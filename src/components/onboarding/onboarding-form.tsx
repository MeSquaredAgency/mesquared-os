"use client";

import { Check, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveOnboardingAction, submitOnboardingAction } from "@/lib/onboarding/actions";
import { emptyTeamRow, fieldVisible, isAnswered, joinWithAnd, missingRequired, STEPS, TEAM_PERMISSIONS, type Choice, type Field, type OnboardingAnswers, type TaskRow, type TeamRow, type ToolRow } from "@/lib/onboarding/form";
import { cn } from "@/lib/utils";

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: Date } | { kind: "error"; message: string };

const SAVE_DELAY_MS = 1200;
const selectClass = "h-11 w-full rounded-lg border border-input bg-card px-4 text-base text-foreground outline-none hover:border-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * The client's onboarding form: one step at a time, saved as they type, with
 * a summary of anything still needed before it can be sent. Everything the
 * fields can hold is defined in src/lib/onboarding/form.ts; the server keeps
 * only what that definition allows.
 */
export function OnboardingForm({ token, label, initial }: { token: string; label: string; initial: OnboardingAnswers }) {
  const [answers, setAnswers] = useState<OnboardingAnswers>(initial);
  const [stepIndex, setStepIndex] = useState(0);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [sent, setSent] = useState(false);
  const [missing, setMissing] = useState<{ stepId: string; stepTitle: string; label: string; short: string }[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, startSending] = useTransition();
  const dirty = useRef(false);
  const latest = useRef(answers);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    latest.current = answers;
  }, [answers]);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!dirty.current) return;
    dirty.current = false;
    setSave({ kind: "saving" });
    const result = await saveOnboardingAction(token, latest.current);
    if (result.ok) setSave({ kind: "saved", at: new Date(result.savedAt ?? Date.now()) });
    else {
      dirty.current = true;
      setSave({ kind: "error", message: result.message });
    }
  }, [token]);

  const update = useCallback(
    (key: string, value: OnboardingAnswers[string]) => {
      setAnswers((prev) => ({ ...prev, [key]: value }));
      dirty.current = true;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  // Save when the tab is hidden or closed, so a half-finished step is never lost.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    const onLeave = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        void flush();
        e.preventDefault();
      }
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [flush]);

  // The team step starts with the person filling in the form.
  const step = STEPS[stepIndex];
  useEffect(() => {
    if (step.id !== "team") return;
    const team = (answers.team as TeamRow[] | undefined) ?? [];
    if (team.length === 0) {
      const contact = (k: string) => (typeof answers[k] === "string" ? (answers[k] as string) : "");
      update("team", [emptyTeamRow({ name: contact("contactName"), title: contact("contactRole"), email: contact("contactEmail"), mobile: contact("contactMobile"), approves: true, finances: true, users: true, allRecords: true })]);
    }
  }, [step.id, answers, update]);

  // On a phone the sections are a sideways strip: keep the current one in view.
  const nav = useRef<HTMLElement>(null);
  useEffect(() => {
    const current = nav.current?.querySelector<HTMLElement>('[aria-current="step"]');
    const strip = nav.current;
    if (!current || !strip || strip.scrollWidth <= strip.clientWidth) return;
    const offset = current.getBoundingClientRect().left - strip.getBoundingClientRect().left;
    strip.scrollTo({ left: strip.scrollLeft + offset - strip.clientWidth / 2 + current.clientWidth / 2, behavior: "smooth" });
  }, [stepIndex]);

  const go = (index: number) => {
    void flush();
    setStepIndex(Math.max(0, Math.min(STEPS.length - 1, index)));
    setSendError(null);
    requestAnimationFrame(() => {
      heading.current?.focus();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  const progress = useMemo(() => {
    let answered = 0;
    let total = 0;
    const perStep = STEPS.map((s) => {
      const visible = s.fields.filter((f) => fieldVisible(f, answers));
      const done = visible.filter((f) => isAnswered(f, answers[f.key])).length;
      answered += done;
      total += visible.length;
      return done;
    });
    return { perStep, percent: total ? Math.round((answered / total) * 100) : 0 };
  }, [answers]);

  const stillNeeded = missingRequired(answers);

  const send = () =>
    startSending(async () => {
      setSendError(null);
      if (timer.current) clearTimeout(timer.current);
      const result = await submitOnboardingAction(token, latest.current);
      if (result.ok) {
        dirty.current = false;
        setSent(true);
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        setMissing(result.missing ?? []);
        setSendError(result.missing?.length ? `Still needed before you can send: ${joinWithAnd(result.missing.map((m) => m.short))}.` : result.message);
      }
    });

  if (sent) return <OnboardingSent label={label} />;

  const isLast = stepIndex === STEPS.length - 1;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <p className="kicker">Me² onboarding</p>
        <h1 className="page-title">Welcome{label ? `, ${label}` : ""}</h1>
        <p className="lede">This tells us how your business works and sets up your Me² portal. It takes about 30 minutes. Your answers save as you go, so you can stop and come back with the same link. Short answers and best guesses are fine.</p>
      </header>

      <div className="flex flex-col gap-2" aria-label="Progress">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Step {stepIndex + 1} of {STEPS.length}
          </span>
          <SaveStatus state={save} />
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-accent" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} aria-label={`${progress.percent}% answered`}>
          <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${progress.percent}%` }} />
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
        <nav ref={nav} aria-label="Sections" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => go(i)}
              aria-current={i === stepIndex ? "step" : undefined}
              className={cn("flex shrink-0 items-center gap-2.5 rounded-full border px-3.5 py-2 text-left text-sm transition-colors lg:rounded-lg", i === stepIndex ? "border-foreground bg-card font-medium text-foreground" : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground")}
            >
              <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full text-[11px]", progress.perStep[i] > 0 ? "bg-primary text-primary-foreground" : "border border-border")}>{progress.perStep[i] > 0 ? <Check className="size-3" aria-hidden /> : i + 1}</span>
              <span className="whitespace-nowrap lg:whitespace-normal">{s.title}</span>
            </button>
          ))}
        </nav>

        <section aria-labelledby="step-title" className="flex min-w-0 flex-col gap-6 rounded-2xl border bg-card p-5 shadow-[var(--shadow-card)] sm:p-8">
          <div className="flex flex-col gap-2">
            <h2 id="step-title" ref={heading} tabIndex={-1} className="text-xl font-medium tracking-[-0.02em] outline-none">
              {step.title}
            </h2>
            <p className="text-muted-foreground">{step.intro}</p>
          </div>

          {isLast && <SendSummary stillNeeded={missing.length ? missing : stillNeeded} onJump={(id) => go(STEPS.findIndex((s) => s.id === id))} />}

          <div className="flex flex-col gap-6">
            {step.fields.filter((f) => fieldVisible(f, answers)).map((field) => (
              <FieldInput key={field.key} field={field} answers={answers} onChange={update} />
            ))}
          </div>

          {sendError && (
            <p role="alert" className="rounded-lg bg-red-soft px-4 py-3 text-sm text-red-text">
              {sendError}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-6">
            <Button type="button" variant="outline" onClick={() => go(stepIndex - 1)} disabled={stepIndex === 0}>
              Back
            </Button>
            {isLast ? (
              <Button type="button" size="lg" onClick={send} disabled={sending}>
                {sending ? "Sending…" : "Send to Me²"}
              </Button>
            ) : (
              <Button type="button" onClick={() => go(stepIndex + 1)}>
                Next: {STEPS[stepIndex + 1].title}
              </Button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function SaveStatus({ state }: { state: SaveState }) {
  const text = state.kind === "saving" ? "Saving…" : state.kind === "saved" ? `Saved ${state.at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : state.kind === "error" ? state.message : "Your answers save as you go";
  return (
    <span role="status" aria-live="polite" className={cn("text-right", state.kind === "error" && "text-red-text")}>
      {text}
    </span>
  );
}

function SendSummary({ stillNeeded, onJump }: { stillNeeded: { stepId: string; stepTitle: string; label: string }[]; onJump: (stepId: string) => void }) {
  const elsewhere = stillNeeded.filter((m) => m.stepId !== "send");
  if (!elsewhere.length) return <p className="rounded-lg bg-green-soft px-4 py-3 text-sm text-green-text">Everything else we need is in. Tick the box below and add your name to send it.</p>;
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-accent px-4 py-3 text-sm">
      <p className="font-medium">Still needed before you send:</p>
      <ul className="flex flex-col gap-1">
        {elsewhere.map((m) => (
          <li key={`${m.stepId}-${m.label}`}>
            <button type="button" className="underline underline-offset-4 hover:text-muted-foreground" onClick={() => onJump(m.stepId)}>
              {m.label}
            </button>{" "}
            <span className="text-muted-foreground">({m.stepTitle})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What the client sees once the form is sent, here and whenever they open the link again. */
export function OnboardingSent({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-6 rounded-2xl border bg-card p-7 shadow-[var(--shadow-card)] sm:p-9">
      <p className="kicker">Me² onboarding</p>
      <h1 className="page-title">Thank you{label ? `, ${label}` : ""}</h1>
      <p className="lede">We have your answers. Here is what happens next:</p>
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-base">
        <li>We review everything and set up a first draft of your Me² portal.</li>
        <li>We send you an upload folder for your logo, templates and other files.</li>
        <li>We book your intake call, about 60 minutes, to go through anything you skipped.</li>
        <li>You approve the plan, we connect your systems, invite your team, and we start.</li>
      </ol>
      <p className="text-sm text-muted-foreground">Need to change something? Contact your Me² onboarding lead and we’ll reopen it for you.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

function FieldShell({ field, htmlFor, children }: { field: Field; htmlFor?: string; children: React.ReactNode }) {
  const hintId = field.hint ? `${field.key}-hint` : undefined;
  const Label = htmlFor ? "label" : "p";
  return (
    <div className="flex flex-col gap-2">
      <Label {...(htmlFor ? { htmlFor } : {})} className="text-sm font-medium">
        {field.label}
        {field.required && <span className="text-muted-foreground"> (required)</span>}
      </Label>
      {field.hint && (
        <p id={hintId} className="-mt-1 text-sm text-muted-foreground">
          {field.hint}
        </p>
      )}
      {children}
    </div>
  );
}

function FieldInput({ field, answers, onChange }: { field: Field; answers: OnboardingAnswers; onChange: (key: string, value: OnboardingAnswers[string]) => void }) {
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
        <FieldShell field={field} htmlFor={id}>
          <Input
            id={id}
            type={field.kind === "number" ? "text" : field.kind === "url" ? "text" : field.kind}
            inputMode={field.kind === "number" ? "decimal" : field.kind === "url" ? "url" : undefined}
            autoComplete={field.key === "contactEmail" ? "email" : field.key === "contactName" || field.key === "signedName" ? "name" : field.key === "contactMobile" ? "tel" : undefined}
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
        <FieldShell field={field} htmlFor={id}>
          <Textarea id={id} rows={3} className="min-h-24" value={str} maxLength={field.maxLength ?? 3000} placeholder={field.placeholder} aria-describedby={describedBy} onChange={(e) => onChange(field.key, e.target.value)} />
        </FieldShell>
      );
    case "select":
      return (
        <FieldShell field={field} htmlFor={id}>
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
        <fieldset className="flex flex-col gap-2" aria-describedby={describedBy}>
          <legend className="mb-2 text-sm font-medium">
            {field.label}
            {field.required && <span className="text-muted-foreground"> (required)</span>}
          </legend>
          <Pills name={id} options={field.options} value={str} onChange={(v) => onChange(field.key, v)} />
        </fieldset>
      );
    case "checks": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <fieldset className="flex flex-col gap-2" aria-describedby={describedBy}>
          <legend className="mb-1 text-sm font-medium">{field.label}</legend>
          {field.hint && (
            <p id={describedBy} className="text-sm text-muted-foreground">
              {field.hint}
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {field.options.map((o) => (
              <CheckRow key={o} label={o} checked={selected.includes(o)} onChange={(on) => onChange(field.key, on ? [...selected, o] : selected.filter((x) => x !== o))} />
            ))}
          </div>
        </fieldset>
      );
    }
    case "confirm":
      return <CheckRow label={field.label} checked={str === "yes"} onChange={(on) => onChange(field.key, on ? "yes" : "")} />;
    case "team":
      return <TeamEditor rows={(value as TeamRow[] | undefined) ?? []} onChange={(rows) => onChange(field.key, rows)} />;
    case "teamSelect": {
      const team = ((answers.team as TeamRow[] | undefined) ?? []).filter((r) => r.email.trim());
      return (
        <FieldShell field={field} htmlFor={id}>
          <select id={id} className={selectClass} value={str} onChange={(e) => onChange(field.key, e.target.value)}>
            <option value="">{team.length ? "Choose a person" : "Add your team above first"}</option>
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
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">{field.label}</legend>
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
        </fieldset>
      );
    }
    case "tasks": {
      const rows = (value as Record<string, TaskRow> | undefined) ?? {};
      const set = (task: string, patch: Partial<TaskRow>) => onChange(field.key, { ...rows, [task]: { ...(rows[task] ?? { hours: "", hand: "" }), ...patch } });
      return (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">{field.label}</legend>
          {field.options.map((task) => (
            <div key={task} className="flex flex-col gap-2 rounded-lg border px-3 py-3 sm:flex-row sm:items-center">
              <span className="flex-1 text-sm">{task}</span>
              <div className="flex flex-wrap items-center gap-2">
                <Input aria-label={`${task}: hours a week`} className="h-9 w-24 px-3" inputMode="decimal" placeholder="hrs/wk" maxLength={20} value={rows[task]?.hours ?? ""} onChange={(e) => set(task, { hours: e.target.value })} />
                <Pills name={`task-${task}`} compact ariaLabel={`Hand ${task} to Me²?`} options={[{ value: "Yes", label: "Hand over" }, { value: "Maybe", label: "Maybe" }, { value: "No", label: "Keep" }]} value={rows[task]?.hand ?? ""} onChange={(v) => set(task, { hand: v as Choice })} />
              </div>
            </div>
          ))}
        </fieldset>
      );
    }
    case "tools": {
      const rows = (value as Record<string, ToolRow> | undefined) ?? {};
      const set = (area: string, patch: Partial<ToolRow>) => onChange(field.key, { ...rows, [area]: { ...(rows[area] ?? { tool: "", access: "" }), ...patch } });
      return (
        <fieldset className="flex flex-col gap-2" aria-describedby={describedBy}>
          <legend className="mb-1 text-sm font-medium">{field.label}</legend>
          {field.hint && (
            <p id={describedBy} className="mb-1 text-sm text-muted-foreground">
              {field.hint}
            </p>
          )}
          {field.options.map(({ area, placeholder }) => (
            <div key={area} className="flex flex-col gap-2 rounded-lg border px-3 py-3 sm:flex-row sm:items-center">
              <span className="text-sm sm:w-48 sm:shrink-0">{area}</span>
              <Input aria-label={`${area}: tool`} className="h-9 sm:flex-1" placeholder={placeholder} maxLength={200} value={rows[area]?.tool ?? ""} onChange={(e) => set(area, { tool: e.target.value })} />
              <Pills name={`tool-${area}`} compact ariaLabel={`Can we have access to your ${area.toLowerCase()} tool?`} options={[{ value: "Yes", label: "Access OK" }, { value: "Maybe", label: "Maybe" }, { value: "No", label: "No" }]} value={rows[area]?.access ?? ""} onChange={(v) => set(area, { access: v as Choice })} />
            </div>
          ))}
        </fieldset>
      );
    }
  }
}

function Pills({ name, options, value, onChange, compact, ariaLabel }: { name: string; options: { value: string; label: string }[]; value: string; onChange: (v: string) => void; compact?: boolean; ariaLabel?: string }) {
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

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
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
            <legend className="mb-1 text-sm font-medium">What should they be able to do?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {TEAM_PERMISSIONS.map((p) => (
                <label key={p.key} className={cn("flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors hover:border-foreground", row[p.key] && "border-foreground")}>
                  <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" checked={row[p.key]} onChange={(e) => set(i, { [p.key]: e.target.checked })} />
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
