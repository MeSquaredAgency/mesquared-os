"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FieldInput } from "@/components/onboarding/fields";
import { Badge } from "@/components/ui/badge";
import { saveCallSheetAction } from "@/lib/onboarding/actions";
import { askedOnCall, CALL_SECTIONS, fieldByKey, fieldVisible, isAnswered, type OnboardingAnswers } from "@/lib/onboarding/form";
import { cn } from "@/lib/utils";

const SAVE_DELAY_MS = 1500;

/** The answers that matter most to the workspace and are rarely on the client's form: worth asking on every call. */
const KEY_GAPS = ["greenCriteria", "autoHandled", "bookingWindow", "customerValue", "stages", "quoteQuiet", "tools", "voice", "claims", "consent"];

/**
 * The operator's intake call sheet. Every section of the questionnaire on one
 * page, the client's answers already in, saved as the operator types. Only the
 * fields the operator changed are sent, so the client editing their own form
 * at the same time is never overwritten.
 */
export function CallSheet({ id, initial, readOnly }: { id: string; initial: OnboardingAnswers; readOnly: boolean }) {
  const [answers, setAnswers] = useState<OnboardingAnswers>(initial);
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" | "error"; text?: string }>({ kind: "idle" });
  const changed = useRef(new Map<string, OnboardingAnswers[string]>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (changed.current.size === 0) return;
    const patch = Object.fromEntries(changed.current);
    changed.current.clear();
    setStatus({ kind: "saving" });
    const r = await saveCallSheetAction(id, patch);
    if (r.ok) setStatus({ kind: "saved" });
    else {
      for (const [k, v] of Object.entries(patch)) if (!changed.current.has(k)) changed.current.set(k, v);
      setStatus({ kind: "error", text: r.message });
    }
  }, [id]);

  const update = useCallback(
    (key: string, value: OnboardingAnswers[string]) => {
      if (readOnly) return;
      setAnswers((prev) => ({ ...prev, [key]: value }));
      changed.current.set(key, value);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush, readOnly],
  );

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [flush]);

  const asked = askedOnCall(answers);
  const gaps = KEY_GAPS.map((k) => fieldByKey(k)!).filter((f) => !isAnswered(f, answers[f.key]) && !asked.some((a) => a.key === f.key));

  return (
    <div className="flex flex-col gap-6">
      {/* Section jumps and the save state, kept in view while scrolling a long sheet. */}
      <div className="sticky top-14 z-10 -mx-4 flex flex-wrap items-center justify-between gap-3 border-b bg-background/95 px-4 py-2 backdrop-blur md:top-0 md:-mx-1 md:px-1">
        <nav aria-label="Call sheet sections" className="scrollbar-none -mx-1 flex gap-1.5 overflow-x-auto px-1 md:flex-wrap md:overflow-visible">
          {CALL_SECTIONS.map((s) => (
            <a key={s.id} href={`#call-${s.id}`} className="shrink-0 rounded-full border border-border-strong px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground hover:text-foreground">
              {s.title}
            </a>
          ))}
        </nav>
        <span role="status" aria-live="polite" className={cn("text-xs text-muted-foreground", status.kind === "error" && "text-red-text")}>
          {readOnly ? "Read-only" : status.kind === "saving" ? "Saving…" : status.kind === "saved" ? "Saved" : status.kind === "error" ? status.text : "Saves as you type"}
        </span>
      </div>

      {(asked.length > 0 || gaps.length > 0) && (
        <div className="surface flex flex-col gap-4 p-5">
          {asked.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">The client asked to cover these on the call</p>
              <ul className="flex flex-wrap gap-1.5">
                {asked.map((f) => (
                  <li key={f.key}>
                    <Badge variant={isAnswered(f, answers[f.key]) ? "muted" : "amber"} className={cn("whitespace-normal text-left", isAnswered(f, answers[f.key]) && "line-through")}>
                      {f.callLabel ?? f.label}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {gaps.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">Still blank and worth asking</p>
              <ul className="flex flex-wrap gap-1.5">
                {gaps.map((f) => (
                  <li key={f.key}>
                    <Badge variant="outline" className="whitespace-normal text-left">{f.callLabel ?? f.label}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <fieldset disabled={readOnly} className="flex flex-col gap-6">
        {CALL_SECTIONS.map((section) => (
          <section key={section.id} id={`call-${section.id}`} aria-labelledby={`call-${section.id}-title`} className="surface flex scroll-mt-28 flex-col gap-6 p-5 sm:p-6 md:scroll-mt-14">
            <div className="flex flex-col gap-1">
              <h2 id={`call-${section.id}-title`} className="section-title">
                {section.title}
              </h2>
              <p className="text-sm text-muted-foreground">{section.intro}</p>
            </div>
            {section.fields.filter((f) => fieldVisible(f, answers)).map((field) => (
              <FieldInput key={field.key} field={field} answers={answers} onChange={update} audience="operator" />
            ))}
          </section>
        ))}
      </fieldset>
    </div>
  );
}
