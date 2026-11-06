import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AgentRunControls } from "@/components/console/agent-run-controls";
import { PageHeader, Section } from "@/components/shell/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatUsdMicros } from "@/lib/ai/prices";
import { loadRunPage, type ActionView, type TimelineEntry } from "@/lib/agents/views";
import { getConsoleContext } from "@/lib/auth/access";
import { formatDateTime, humanize, timeAgo } from "@/lib/utils";

export const metadata = { title: "Agent run" };

const FINISHED = new Set(["DONE", "FAILED", "CANCELLED"]);

/**
 * One agent run, step by step: the task it was given, what it thought, said and did, what a person decided, and
 * how it ended. While it has not finished, it can be paused, guided or cancelled from here.
 */
export default async function AgentRunPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  const { tenants } = await getConsoleContext();
  const access = tenants.find((t) => t.tenant.slug === slug);
  if (!access) notFound();
  const tenant = access.tenant;
  const page = await loadRunPage(tenant, id);
  if (!page) notFound();
  const { run, timeline } = page;
  const base = `/console/${tenant.slug}`;
  const fmt = { timezone: tenant.timezone, locale: tenant.locale };
  const finished = FINISHED.has(run.status);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={
          <>
            <Link href="/console" className="hover:text-foreground hover:underline">
              Portfolio
            </Link>
            <span aria-hidden="true">/</span>
            <Link href={base} className="hover:text-foreground hover:underline">
              {tenant.name}
            </Link>
            <span aria-hidden="true">/</span>
            <Link href={`${base}/agents`} className="hover:text-foreground hover:underline">
              Agents
            </Link>
          </>
        }
        title={`${page.agentName} run`}
        lede={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Badge variant={page.status.tone}>{page.status.label}</Badge>
            <span>Started {timeAgo(run.createdAt)}</span>
            <span>{humanize(run.trigger)}</span>
            <span className="num">
              {run.steps} step{run.steps === 1 ? "" : "s"} · {formatUsdMicros(run.costMicros, tenant.locale)}
            </span>
            <span>{humanize(run.autonomy)}</span>
          </span>
        }
        actions={
          <Button asChild variant="outline">
            <Link href={`${base}/agents`}>
              <ArrowLeft /> All runs
            </Link>
          </Button>
        }
      />

      <div className="grid gap-8 xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] xl:items-start">
        <Section id="timeline-title" title="What it did" lede="Each step in order. Its thinking is Claude’s own summary of its reasoning.">
          <ol className="flex flex-col gap-3">
            {timeline.map((entry, i) => (
              <Entry key={i} entry={entry} fmt={fmt} queueHref={`/console/queue?workspace=${tenant.slug}&view=agent`} />
            ))}
          </ol>
          {/* A finished run's last words are its summary, already above; a stopped one says why. */}
          {(run.status === "FAILED" || run.status === "CANCELLED") && (
            <div className={`surface p-5 ${run.status === "FAILED" ? "border-red/40" : ""}`}>
              <p className="eyebrow mb-1">{run.status === "FAILED" ? "Why it stopped" : "Why it was cancelled"}</p>
              <p className="whitespace-pre-wrap text-sm">{(run.status === "FAILED" ? run.error : run.summary) ?? "No reason was recorded."}</p>
              {run.finishedAt && <p className="mt-2 text-xs text-muted-foreground">{formatDateTime(run.finishedAt, fmt)}</p>}
            </div>
          )}
          {run.status === "DONE" && run.finishedAt && <p className="text-xs text-muted-foreground">Finished {formatDateTime(run.finishedAt, fmt)}.</p>}
        </Section>

        <aside className="flex flex-col gap-8">
          {!finished && (
            <Section id="controls-title" title="Step in" lede="Pause it, point it in the right direction, or stop it.">
              <div className="surface p-5">
                <AgentRunControls tenantId={tenant.id} runId={run.id} status={run.status} waitingOnPerson={page.waitingOnPerson} />
              </div>
            </Section>
          )}
          <Section id="facts-title" title="About this run">
            <dl className="surface grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 p-5 text-sm">
              <dt className="text-muted-foreground">Model</dt>
              <dd className="font-mono text-xs">{run.model}</dd>
              <dt className="text-muted-foreground">Tokens</dt>
              <dd className="num">{run.tokens.toLocaleString(tenant.locale)}</dd>
              {run.missedOpportunityId && (
                <>
                  <dt className="text-muted-foreground">For</dt>
                  <dd>
                    <Link href={`/app/${tenant.slug}/opportunities/${run.missedOpportunityId}`} className="underline underline-offset-4">
                      The missed opportunity
                    </Link>
                  </dd>
                </>
              )}
              {run.attempts > 0 && run.error && !finished && (
                <>
                  <dt className="text-muted-foreground">Last failure</dt>
                  <dd className="text-red-text">
                    {run.error} (try {run.attempts} of 3)
                  </dd>
                </>
              )}
            </dl>
          </Section>
        </aside>
      </div>
    </div>
  );
}

type Fmt = { timezone: string; locale: string };

function Entry({ entry, fmt, queueHref }: { entry: TimelineEntry; fmt: Fmt; queueHref: string }) {
  const at = <time className="text-xs text-muted-foreground">{formatDateTime(entry.at, fmt)}</time>;
  switch (entry.kind) {
    case "task":
      return (
        <li className="surface flex flex-col gap-2 p-5">
          <p className="flex items-center justify-between gap-3">
            <span className="eyebrow">The task</span>
            {at}
          </p>
          <p className="whitespace-pre-wrap text-sm">{entry.text}</p>
        </li>
      );
    case "thinking":
      return (
        <li className="px-5">
          <details className="text-sm text-muted-foreground">
            <summary className="cursor-pointer select-none">Thinking</summary>
            <p className="mt-2 whitespace-pre-wrap">{entry.text ?? "Some of its reasoning is encrypted and isn’t shown."}</p>
          </details>
        </li>
      );
    case "said":
      return (
        <li className="px-5">
          <p className="whitespace-pre-wrap text-sm">{entry.text}</p>
        </li>
      );
    case "guidance":
      return (
        <li className="surface flex flex-col gap-2 border-blue/30 p-5">
          <p className="flex flex-wrap items-center justify-between gap-3">
            <span className="eyebrow">Guidance from {entry.by}</span>
            <span className="flex items-center gap-2">
              {!entry.read && <Badge variant="amber">Not read yet</Badge>}
              {at}
            </span>
          </p>
          <p className="whitespace-pre-wrap text-sm">{entry.text}</p>
        </li>
      );
    case "action":
      return <Action action={entry.action} at={at} fmt={fmt} queueHref={queueHref} />;
  }
}

function Action({ action, at, fmt, queueHref }: { action: ActionView; at: React.ReactNode; fmt: Fmt; queueHref: string }) {
  return (
    <li className="surface flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium">{action.title}</p>
          <p className="text-xs text-muted-foreground">{action.reason}</p>
        </div>
        <span className="flex items-center gap-2">
          <Badge variant={action.tone}>{action.label}</Badge>
          {at}
        </span>
      </div>
      {action.body && <p className="whitespace-pre-wrap rounded-md border bg-muted/40 px-3 py-2 text-sm">{action.body}</p>}
      {action.waiting && (
        <Link href={queueHref} className="w-fit text-sm underline underline-offset-4">
          Decide it in the queue
        </Link>
      )}
      {action.decidedBy && (
        <p className="text-xs text-muted-foreground">
          Decided by {action.decidedBy}
          {action.decidedAt ? `, ${formatDateTime(action.decidedAt, fmt)}` : ""}.
        </p>
      )}
      {action.edited && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium">What the person changed</p>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 font-mono text-xs">{action.edited}</pre>
        </div>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer select-none text-muted-foreground">What it asked for{action.result !== null ? ", and what came back" : ""}</summary>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 font-mono">{action.input}</pre>
        {action.result !== null && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 font-mono">{action.result}</pre>}
      </details>
    </li>
  );
}
