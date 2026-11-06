"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldGrid } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { commentOnTaskAction, updateTaskAction } from "@/lib/tasks/actions";
import type { Side, TaskStatus } from "@/lib/types";
import type { PersonOption } from "./new-task-form";

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "OPEN", label: "To do" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "WAITING", label: "Blocked" },
  { value: "DONE", label: "Done" },
  { value: "CANCELLED", label: "Cancelled" },
];

interface Props {
  slug: string;
  taskId: string;
  viewer: Side;
  people: PersonOption[];
  timezone: string;
  initial: { title: string; details: string; status: TaskStatus; owner: Side; assigneeId: string; due: string };
}

/** The task's fields, saved together; every change lands in the activity log. "Mark done" is one click. */
export function TaskEditor({ slug, taskId, viewer, people, timezone, initial }: Props) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const dirty = (Object.keys(initial) as (keyof typeof initial)[]).some((k) => form[k] !== initial[k]);
  const closed = initial.status === "DONE" || initial.status === "CANCELLED";
  const sideName = (s: Side) => (s === "ME2" ? "Me²" : viewer === "CLIENT" ? "Your team" : "Client");

  const save = (edit: Partial<typeof form>) =>
    start(async () => {
      setNotice(null);
      const r = await updateTaskAction(slug, taskId, { ...edit, ...(edit.assigneeId !== undefined ? { assigneeId: edit.assigneeId || null } : {}), ...(edit.due !== undefined ? { due: edit.due || null } : {}) });
      setNotice({ tone: r.ok ? "ok" : "error", text: r.message });
      if (r.ok) router.refresh();
    });

  return (
    <div className="surface flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="section-title">Details</h2>
        {closed ? (
          <Button variant="outline" size="sm" disabled={pending} onClick={() => save({ status: "OPEN" })}>
            <RotateCcw /> Reopen
          </Button>
        ) : (
          <Button size="sm" disabled={pending} onClick={() => save({ status: "DONE" })}>
            <Check /> Mark done
          </Button>
        )}
      </div>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      <Field label="Title">
        <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={200} />
      </Field>
      <Field label="Details">
        <Textarea value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} placeholder="Anything that helps it get done" className="min-h-20" />
      </Field>
      <FieldGrid columns={2}>
        <Field label="Status">
          <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as TaskStatus })}>
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Waiting on">
          <Select value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value as Side })}>
            <option value="ME2">{sideName("ME2")}</option>
            <option value="CLIENT">{sideName("CLIENT")}</option>
          </Select>
        </Field>
        <Field label="Assigned to">
          <Select value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}>
            <option value="">Nobody yet</option>
            {people.map((p) => (
              <option key={p.userId} value={p.userId}>
                {p.name}
                {p.side === "ME2" ? " (Me²)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Deadline" hint={`${timezone.split("/").pop()?.replace(/_/g, " ")} time. Reminders go a day before and when it passes.`}>
          <Input type="datetime-local" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} />
        </Field>
      </FieldGrid>
      {dirty && (
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button variant="ghost" disabled={pending} onClick={() => setForm(initial)}>
            Discard
          </Button>
          <Button disabled={pending || form.title.trim().length < 2} onClick={() => save(form)}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      )}
    </div>
  );
}

/** A comment on the task; it lands in the activity log for both sides to read. */
export function TaskComment({ slug, taskId }: { slug: string; taskId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setError(null);
          const r = await commentOnTaskAction(slug, taskId, text);
          if (!r.ok) return setError(r.message);
          setText("");
          router.refresh();
        });
      }}
    >
      {error && <Notice tone="error">{error}</Notice>}
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a comment or an update" className="min-h-20" aria-label="Comment" />
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={pending || !text.trim()}>
          {pending ? "Posting…" : "Comment"}
        </Button>
      </div>
    </form>
  );
}
