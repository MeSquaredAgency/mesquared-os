"use client";

import { ArrowRight, Check, MessageCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { saveOnboardingAction, submitOnboardingAction } from "@/lib/onboarding/actions";
import { ASK_ON_CALL, CLIENT_STEPS, emptyTeamRow, fieldByKey, fieldVisible, isAnswered, joinWithAnd, missingRequired, presetTimezoneFor, type Field, type OnboardingAnswers, type TeamRow } from "@/lib/onboarding/form";
import { REGION_PRESETS } from "@/lib/tenants/regions";
import { cn } from "@/lib/utils";
import { FieldInput } from "./fields";

type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: Date } | { kind: "error"; message: string };
type Missing = { stepId: string; stepTitle: string; label: string; short: string };

const SAVE_DELAY_MS = 1200;
const TOTAL_MINUTES = CLIENT_STEPS.reduce((n, s) => n + (s.minutes ?? 2), 0);

/**
 * The client's onboarding form: a welcome, four short steps, and a recap.
 * Answers save as they type. Optional questions can be left for the intake
 * call with one tap, which puts them on the operator's call sheet.
 */
export function OnboardingForm({ token, label, initial, fresh }: { token: string; label: string; initial: OnboardingAnswers; fresh: boolean }) {
  const [answers, setAnswers] = useState<OnboardingAnswers>(initial);
  const [started, setStarted] = useState(!fresh);
  const [stepIndex, setStepIndex] = useState(0);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [sent, setSent] = useState(false);
  const [missing, setMissing] = useState<Missing[]>([]);
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
      setAnswers((prev) => {
        const next = { ...prev, [key]: value };
        // Answering a question takes it off the "ask me on the call" list.
        const asked = Array.isArray(prev[ASK_ON_CALL]) ? (prev[ASK_ON_CALL] as string[]) : [];
        const field = fieldByKey(key);
        if (field && asked.includes(key) && isAnswered(field, value)) next[ASK_ON_CALL] = asked.filter((k) => k !== key);
        return next;
      });
      dirty.current = true;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  const asked = Array.isArray(answers[ASK_ON_CALL]) ? (answers[ASK_ON_CALL] as string[]) : [];
  const setAsked = (key: string, on: boolean) => update(ASK_ON_CALL, on ? [...new Set([...asked, key])] : asked.filter((k) => k !== key));

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

  // A good first guess at the time zone, from the browser.
  useEffect(() => {
    if (typeof answers.timezone === "string" && answers.timezone) return;
    const guess = presetTimezoneFor(Intl.DateTimeFormat().resolvedOptions().timeZone);
    if (guess) update("timezone", guess);
    // Only on first load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The team starts with the person filling in the form, able to do everything.
  const step = CLIENT_STEPS[stepIndex];
  useEffect(() => {
    if (step.id !== "team") return;
    const team = (answers.team as TeamRow[] | undefined) ?? [];
    if (team.length === 0) {
      const contact = (k: string) => (typeof answers[k] === "string" ? (answers[k] as string) : "");
      update("team", [emptyTeamRow({ name: contact("contactName"), email: contact("contactEmail"), mobile: contact("contactMobile"), approves: true, finances: true, users: true, allRecords: true })]);
    }
  }, [step.id, answers, update]);

  const go = (index: number) => {
    void flush();
    setStepIndex(Math.max(0, Math.min(CLIENT_STEPS.length - 1, index)));
    setSendError(null);
    requestAnimationFrame(() => {
      heading.current?.focus();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

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

  if (sent) return <OnboardingSent label={label} answers={answers} />;
  if (!started) return <Welcome label={label} onStart={() => setStarted(true)} />;

  const isLast = stepIndex === CLIENT_STEPS.length - 1;
  const minutesLeft = CLIENT_STEPS.slice(stepIndex).reduce((n, s) => n + (s.minutes ?? 2), 0);
  const stillNeeded = missing.length ? missing : missingRequired(answers);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>
            Step {stepIndex + 1} of {CLIENT_STEPS.length} · about {minutesLeft} minute{minutesLeft === 1 ? "" : "s"} left
          </span>
          <SaveStatus state={save} />
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-border" role="progressbar" aria-valuemin={1} aria-valuemax={CLIENT_STEPS.length} aria-valuenow={stepIndex + 1} aria-label={`Step ${stepIndex + 1} of ${CLIENT_STEPS.length}`}>
          <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${((stepIndex + 1) / CLIENT_STEPS.length) * 100}%` }} />
        </div>
        <nav aria-label="Steps" className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1">
          {CLIENT_STEPS.map((s, i) => {
            const done = i < stepIndex;
            return (
              <button key={s.id} type="button" onClick={() => go(i)} aria-current={i === stepIndex ? "step" : undefined} className={cn("flex shrink-0 items-center gap-2 rounded-full border px-2.5 py-1 text-xs transition-colors", i === stepIndex ? "border-border-strong bg-card font-medium text-foreground" : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground")}>
                <span className={cn("flex size-4.5 items-center justify-center rounded-full text-2xs num", done ? "bg-primary text-primary-foreground" : "border border-border-strong")}>{done ? <Check className="size-2.5" aria-hidden /> : i + 1}</span>
                {s.nav ?? s.title}
              </button>
            );
          })}
        </nav>
      </div>

      <section aria-labelledby="step-title" className="surface flex flex-col gap-7 p-5 sm:p-8">
        <div className="flex flex-col gap-1.5">
          <h1 id="step-title" ref={heading} tabIndex={-1} className="page-title outline-none">
            {step.title}
          </h1>
          <p className="text-sm text-muted-foreground">{step.intro}</p>
        </div>

        <div className="flex flex-col gap-6">
          {step.fields.filter((f) => fieldVisible(f, answers)).map((field) =>
            field.onCall && asked.includes(field.key) ? (
              <AskedOnCall key={field.key} field={field} onUndo={() => setAsked(field.key, false)} />
            ) : (
              <div key={field.key} className="flex flex-col gap-1.5">
                <FieldInput field={field} answers={answers} onChange={update} />
                {field.onCall && !isAnswered(field, answers[field.key]) && (
                  <button type="button" onClick={() => setAsked(field.key, true)} className="self-start text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                    Not sure? Ask me on the call
                  </button>
                )}
              </div>
            ),
          )}
        </div>

        {isLast && stillNeeded.length > 0 && (
          <div className="flex flex-col gap-2 rounded-md bg-muted px-4 py-3 text-sm">
            <p className="font-medium">A couple of things before you send:</p>
            <ul className="flex flex-col gap-1">
              {stillNeeded.map((m) => (
                <li key={`${m.stepId}-${m.label}`}>
                  <button type="button" className="underline underline-offset-4 hover:text-muted-foreground" onClick={() => go(CLIENT_STEPS.findIndex((s) => s.id === m.stepId))}>
                    {m.label}
                  </button>{" "}
                  <span className="text-muted-foreground">({m.stepTitle})</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {sendError && (
          <Notice tone="error" role="alert">
            {sendError}
          </Notice>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
          <Button type="button" variant="outline" onClick={() => (stepIndex === 0 ? setStarted(false) : go(stepIndex - 1))}>
            Back
          </Button>
          {isLast ? (
            <Button type="button" onClick={send} disabled={sending}>
              {sending ? "Sending…" : "Send to Me²"}
            </Button>
          ) : (
            <Button type="button" onClick={() => go(stepIndex + 1)}>
              Next <ArrowRight aria-hidden />
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

function Welcome({ label, onStart }: { label: string; onStart: () => void }) {
  return (
    <div className="surface flex flex-col gap-7 p-6 sm:p-9">
      <div className="flex flex-col gap-2">
        <p className="eyebrow">Me² onboarding</p>
        <h1 className="page-title">Welcome{label ? `, ${label}` : ""}</h1>
        <p className="lede">This helps us set up your Me² portal before we talk. It takes about {TOTAL_MINUTES} minutes, and nothing here is final: we’ll go through it together on your intake call.</p>
      </div>
      <ol className="divide-y border-y">
        {CLIENT_STEPS.map((s, i) => (
          <li key={s.id} className="flex items-center gap-3 py-2.5 text-sm">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border-strong text-xs num">{i + 1}</span>
            <span className="flex-1">{s.title}</span>
            <span className="text-xs text-muted-foreground">{s.minutes ?? 2} min</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-3">
        <Button type="button" className="self-start" onClick={onStart}>
          Let’s go <ArrowRight aria-hidden />
        </Button>
        <p className="text-sm text-muted-foreground">Your answers save as you go, so you can stop and come back with this link. Not sure about something? Leave it for the call.</p>
      </div>
    </div>
  );
}

function AskedOnCall({ field, onUndo }: { field: Field; onUndo: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-border-strong px-4 py-3">
      <div className="flex items-start gap-3">
        <MessageCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="flex flex-col">
          <span className="text-sm font-medium">{field.label}</span>
          <span className="text-sm text-muted-foreground">We’ll ask you about this on the call.</span>
        </div>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onUndo}>
        Answer now
      </Button>
    </div>
  );
}

function SaveStatus({ state }: { state: SaveState }) {
  const text = state.kind === "saving" ? "Saving…" : state.kind === "saved" ? "Saved" : state.kind === "error" ? state.message : "Saves as you go";
  return (
    <span role="status" aria-live="polite" className={cn("text-right", state.kind === "error" && "text-red-text")}>
      {text}
    </span>
  );
}

/** What the client sees once the form is sent, here and whenever they open the link again. */
export function OnboardingSent({ label, answers }: { label: string; answers: OnboardingAnswers }) {
  const text = (k: string) => (typeof answers[k] === "string" ? (answers[k] as string).trim() : "");
  const team = ((answers.team as TeamRow[] | undefined) ?? []).filter((r) => r.name.trim() || r.email.trim());
  const handOver = Array.isArray(answers.handOver) ? (answers.handOver as string[]) : [];
  const forCall = Array.isArray(answers[ASK_ON_CALL]) ? (answers[ASK_ON_CALL] as string[]) : [];
  const zone = REGION_PRESETS.find((p) => p.timezone === text("timezone"))?.label;
  const recap = [
    text("businessType") && `${text("businessType") === "Other" ? text("businessTypeOther") || "Your business" : text("businessType")}${zone ? `, ${zone}` : ""}`,
    team.length > 0 && `${team.length} ${team.length === 1 ? "person" : "people"} on your team`,
    text("firstResponse") && `New enquiries hear back within ${text("firstResponse")}`,
    handOver.length > 0 && `${handOver.length} task${handOver.length === 1 ? "" : "s"} you'd like us to take on`,
    forCall.length > 0 && `${forCall.length} question${forCall.length === 1 ? "" : "s"} saved for the call`,
  ].filter(Boolean) as string[];

  return (
    <div className="surface flex flex-col gap-7 p-6 sm:p-9">
      <div className="flex flex-col gap-2">
        <p className="eyebrow">Me² onboarding</p>
        <h1 className="page-title">Thank you{label ? `, ${label}` : ""}</h1>
        <p className="lede">That’s everything we need before your intake call.</p>
      </div>
      {recap.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold">What you told us</p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {recap.map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <Check className="mt-0.5 size-4 shrink-0 text-green-text" aria-hidden />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold">What happens next</p>
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">
          <li>We set up a first draft of your Me² portal from your answers.</li>
          <li>We book your intake call, about 60 minutes, and go through anything you left for it.</li>
          <li>You approve the plan, we connect your systems and invite your team, and we start.</li>
        </ol>
      </div>
      <div className="flex flex-col gap-1.5 rounded-md bg-muted px-4 py-3 text-sm">
        <p className="font-medium">Handy to have ready for the call</p>
        <p className="text-muted-foreground">Your logo files, any quote or invoice templates, a list of past customers if you’d like us to get back in touch with them, and the systems you use day to day. Please don’t email passwords; we’ll set up access with you securely.</p>
      </div>
      <p className="text-sm text-muted-foreground">Need to change something? Contact your Me² onboarding lead and we’ll reopen it for you.</p>
    </div>
  );
}
