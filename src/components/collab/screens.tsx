import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ListChecks, Lock } from "lucide-react";
import { FilterChips } from "@/components/shell/filter-chips";
import { Empty, PageHeader, Section } from "@/components/shell/section";
import { Button } from "@/components/ui/button";
import { CHAT_MAX_LENGTH, readChat } from "@/lib/chat";
import { sideOf } from "@/lib/collab/people";
import { repository } from "@/lib/data";
import { dueState, isOpen, STATUS_LABEL, toLocalInput } from "@/lib/tasks";
import type { TenantAccess, TenantPersonRecord, UserRecord } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
import { ChatComposer } from "./chat-composer";
import { ChatThread } from "./chat-thread";
import { ownerLabel } from "./labels";
import { NewTaskForm, type PersonOption } from "./new-task-form";
import { TaskActivity } from "./task-activity";
import { TaskComment, TaskEditor } from "./task-editor";
import { DueChip, TaskList } from "./task-list";

interface ScreenProps {
  access: TenantAccess;
  user: UserRecord;
  /** "/app/<slug>" or "/console/<slug>". */
  base: string;
  eyebrow?: React.ReactNode;
}

const personOptions = (people: TenantPersonRecord[]): PersonOption[] => people.map((p) => ({ userId: p.userId, name: p.name?.trim() || p.email, side: p.via === "member" ? "CLIENT" : "ME2" }));
const nameMap = (people: TenantPersonRecord[]) => Object.fromEntries(people.map((p) => [p.userId, p.name?.trim() || p.email]));

export async function TasksScreen({ access, base, eyebrow, view }: ScreenProps & { view: string }) {
  const tenant = access.tenant;
  const viewer = sideOf(access);
  const now = new Date();
  const [all, people] = await Promise.all([repository.listTasks(tenant.id), repository.listTenantPeople(tenant.id)]);
  const open = all.filter(isOpen);
  const closed = all.filter((t) => !isOpen(t)).sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
  const onYou = open.filter((t) => t.owner === viewer);
  const onThem = open.filter((t) => t.owner !== viewer);
  const overdue = open.filter((t) => dueState(t, now) === "overdue");
  const shown = view === "you" ? onYou : view === "them" ? onThem : view === "done" ? closed : open;
  const them = viewer === "CLIENT" ? "Me²" : "the client";
  const slug = tenant.slug;

  const groups =
    view === "done"
      ? [{ key: "done", title: "Finished", items: shown }]
      : [
          { key: "overdue", title: "Overdue", items: shown.filter((t) => dueState(t, now) === "overdue") },
          { key: "soon", title: "Due within a day", items: shown.filter((t) => dueState(t, now) === "soon") },
          { key: "later", title: "Coming up", items: shown.filter((t) => dueState(t, now) === "later") },
          { key: "none", title: "No deadline", items: shown.filter((t) => dueState(t, now) === "none") },
        ].filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={eyebrow}
        title="Tasks"
        lede={
          open.length === 0
            ? `Nothing open. Add a task for ${them} or for ${viewer === "CLIENT" ? "your team" : "Me²"}, and both sides can follow it.`
            : `${open.length} open${overdue.length ? `, ${overdue.length} overdue` : ""}. ${onYou.length} waiting on ${viewer === "CLIENT" ? "your team" : "Me²"}, ${onThem.length} on ${them}. Reminders go a day before each deadline and when it passes.`
        }
        actions={<NewTaskForm slug={slug} base={base} viewer={viewer} people={personOptions(people)} timezone={tenant.timezone} />}
      />
      <FilterChips
        param="view"
        label="Show"
        chips={[
          { value: "", label: "All open", count: open.length, urgent: overdue.length > 0 },
          { value: "you", label: viewer === "CLIENT" ? "Waiting on you" : "Waiting on Me²", count: onYou.length },
          { value: "them", label: viewer === "CLIENT" ? "Waiting on Me²" : "Waiting on the client", count: onThem.length },
          { value: "done", label: "Done", count: closed.length },
        ]}
      />
      {groups.length === 0 ? (
        <Empty icon={<ListChecks />}>{view === "done" ? "Nothing finished yet." : "No open tasks here. New ones appear as soon as either side adds them."}</Empty>
      ) : (
        groups.map((g) => (
          <Section key={g.key} id={`tasks-${g.key}`} title={g.title} action={<span className="text-xs text-muted-foreground">{g.items.length}</span>}>
            <TaskList tasks={g.items} names={nameMap(people)} tenant={tenant} base={base} viewer={viewer} now={now} />
          </Section>
        ))
      )}
    </div>
  );
}

export async function TaskScreen({ access, base, eyebrow, taskId }: ScreenProps & { taskId: string }) {
  const tenant = access.tenant;
  const viewer = sideOf(access);
  const now = new Date();
  const task = await repository.getTask(tenant.id, taskId);
  if (!task) notFound();
  const [events, people] = await Promise.all([repository.listTaskEvents(tenant.id, task.id), repository.listTenantPeople(tenant.id)]);
  const names = nameMap(people);
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={eyebrow}
        title={task.title}
        lede={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span>{STATUS_LABEL[task.status]}</span>
            <span aria-hidden="true">·</span>
            <span>Waiting on {ownerLabel(task.owner, viewer)}</span>
            {task.assigneeId && (
              <>
                <span aria-hidden="true">·</span>
                <span>{names[task.assigneeId] ?? "Someone who has left"}</span>
              </>
            )}
            <DueChip task={task} tenant={tenant} now={now} />
          </span>
        }
        actions={
          <Button asChild variant="outline">
            <Link href={`${base}/tasks`}>
              <ArrowLeft /> All tasks
            </Link>
          </Button>
        }
      />
      <div className="grid gap-8 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] xl:items-start">
        <Section id="task-activity" title="Activity" lede={`Started ${formatDateTime(task.createdAt, tenant)}. Every change and comment, oldest first.`}>
          <div className="surface flex flex-col gap-6 p-5">
            <TaskActivity events={events} viewer={viewer} tenant={tenant} now={now} />
            <div className="border-t pt-5">
              <TaskComment slug={tenant.slug} taskId={task.id} />
            </div>
          </div>
        </Section>
        <TaskEditor
          key={task.updatedAt.toISOString()}
          slug={tenant.slug}
          taskId={task.id}
          viewer={viewer}
          people={personOptions(people)}
          timezone={tenant.timezone}
          initial={{ title: task.title, details: task.details ?? "", status: task.status, owner: task.owner, assigneeId: task.assigneeId ?? "", due: toLocalInput(task.dueAt, tenant.timezone) }}
        />
      </div>
    </div>
  );
}

export async function MessagesScreen({ access, user, eyebrow }: ScreenProps) {
  const tenant = access.tenant;
  const viewer = sideOf(access);
  const now = new Date();
  const messages = await readChat(tenant.id);
  // Opening the chat is reading it.
  await repository.markChatRead(tenant.id, user.id, now);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={eyebrow}
        title={viewer === "CLIENT" ? "Messages with Me²" : `Messages with ${tenant.name}`}
        lede={viewer === "CLIENT" ? "Talk to your Me² team directly. Questions, approvals, anything that isn't a lead." : "The client's direct line to Me². Everyone on their team and every operator on this workspace can read it."}
      />
      <section aria-label="Chat" className="surface flex h-[min(44rem,calc(100dvh-16rem))] min-h-[26rem] flex-col overflow-hidden p-0">
        <div className="flex items-center gap-2 border-b px-4 py-2.5 text-xs text-muted-foreground sm:px-6">
          <Lock className="size-3.5 shrink-0" aria-hidden="true" />
          <span>Encrypted before it is stored. Only {viewer === "CLIENT" ? "your team and Me²" : `the ${tenant.name} team and Me²`} can read these, and emails only say a message arrived, never what it says.</span>
        </div>
        <ChatThread messages={messages} viewer={viewer} viewerId={user.id} tenant={tenant} now={now} />
        <ChatComposer slug={tenant.slug} placeholder={viewer === "CLIENT" ? "Message Me²" : `Message ${tenant.name}`} maxLength={CHAT_MAX_LENGTH} />
      </section>
    </div>
  );
}
