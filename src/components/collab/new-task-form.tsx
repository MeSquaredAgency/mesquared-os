"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldGrid } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createTaskAction } from "@/lib/tasks/actions";
import type { Side } from "@/lib/types";

export interface PersonOption {
  userId: string;
  name: string;
  side: Side;
}

interface Props {
  slug: string;
  base: string;
  viewer: Side;
  people: PersonOption[];
  /** The workspace's timezone, shown beside the deadline so nobody guesses. */
  timezone: string;
}

/** "New task": a title, who it waits on, who has it and when it is due. Opens inline. */
export function NewTaskForm({ slug, base, viewer, people, timezone }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const blank = { title: "", details: "", owner: "ME2" as Side, assigneeId: "", due: "" };
  const [form, setForm] = useState(blank);
  const sideName = (s: Side) => (s === "ME2" ? "Me²" : viewer === "CLIENT" ? "Your team" : "Client");

  if (!open)
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus /> New task
      </Button>
    );

  return (
    <form
      className="surface rise flex w-full flex-col gap-4 p-5"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await createTaskAction(slug, { ...form, assigneeId: form.assigneeId || null, due: form.due || null, details: form.details || null });
          if (!r.ok) return setError(r.message);
          setForm(blank);
          setOpen(false);
          router.push(`${base}/tasks/${r.taskId}`);
        });
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="section-title">New task</h2>
        <Button type="button" variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close">
          <X />
        </Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <Field label="What needs doing?">
        <Input autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Send the new listing photos" maxLength={200} />
      </Field>
      <Field label="Details (optional)">
        <Textarea value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} placeholder="Anything that helps it get done" className="min-h-20" />
      </Field>
      <FieldGrid columns={3}>
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
        <Field label="Deadline (optional)" hint={`${timezone.split("/").pop()?.replace(/_/g, " ")} time`}>
          <Input type="datetime-local" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} />
        </Field>
      </FieldGrid>
      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || form.title.trim().length < 2}>
          {pending ? "Adding…" : "Add task"}
        </Button>
      </div>
    </form>
  );
}
