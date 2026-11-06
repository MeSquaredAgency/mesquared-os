import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AgentRoster } from "@/components/console/agent-roster";
import { Empty, PageHeader, Section } from "@/components/shell/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatUsdMicros } from "@/lib/ai/prices";
import { agentsMode } from "@/lib/agents/policy";
import { AGENT_ROLES } from "@/lib/agents/roles";
import { agentName, runStatus } from "@/lib/agents/views";
import { getConsoleContext } from "@/lib/auth/access";
import { repository } from "@/lib/data";
import { humanize, timeAgo } from "@/lib/utils";

export const metadata = { title: "Agents" };

const MODE_NOTE = {
  off: "Agents are switched off for this deployment: nothing below moves until they are switched on.",
  shadow: "Agents are in shadow mode for this deployment: they read and propose, and nothing they propose is carried out.",
  live: null,
} as const;

/** The workspace's agent runs, newest first, each linking to its timeline. */
export default async function AgentRunsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const { tenants } = await getConsoleContext();
  const access = tenants.find((t) => t.tenant.slug === slug);
  if (!access) notFound();
  const tenant = access.tenant;
  const base = `/console/${tenant.slug}`;
  const [runs, open, agents] = await Promise.all([repository.listAgentRuns(tenant.id, { limit: 50 }), repository.listExceptions([tenant.id], { limit: 500 }), repository.listTenantAgents(tenant.id)]);
  const roster = AGENT_ROLES.map((role) => {
    const row = agents.find((a) => a.roleKey === role.key);
    return { key: role.key, name: role.name, responsibilities: role.responsibilities, startsOn: role.startsOn ?? null, ready: Boolean(role.startsOn), maxAutonomy: role.maxAutonomy, enabled: row?.enabled ?? false, autonomy: row?.autonomy ?? "SHADOW" };
  });
  const awaiting = new Set(open.filter((e) => e.agentToolCallId && e.agentRunId).map((e) => e.agentRunId));
  const note = MODE_NOTE[agentsMode()];

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
          </>
        }
        title="Agents"
        lede={note ?? "Every piece of work an agent has done here, with what it cost. Open one to see each step."}
        actions={
          <Button asChild variant="outline">
            <Link href={base}>
              <ArrowLeft /> Back to workspace
            </Link>
          </Button>
        }
      />
      <Section id="roster-title" title="This workspace's agents" lede="Each starts off and in shadow. Supervised is the launch setting: a person approves anything a customer will see.">
        <AgentRoster tenantId={tenant.id} rows={roster} />
      </Section>
      <Section id="runs-title" title="Runs" lede={awaiting.size > 0 ? `${awaiting.size} waiting for a person in the queue.` : undefined}>
        {runs.length === 0 ? (
          <Empty>No agent has worked in this workspace yet.</Empty>
        ) : (
          <ul className="surface divide-y px-5">
            {runs.map((run) => {
              const status = runStatus(run, awaiting.has(run.id));
              const outcome = run.status === "FAILED" ? run.error : run.summary;
              return (
                <li key={run.id}>
                  <Link href={`${base}/agents/runs/${run.id}`} className="list-row flex flex-col gap-1.5 py-3.5 sm:flex-row sm:items-center sm:gap-6">
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {agentName(run.roleKey)}
                        <Badge variant={status.tone}>{status.label}</Badge>
                      </p>
                      {outcome && <p className="truncate text-sm text-muted-foreground">{outcome}</p>}
                    </div>
                    <p className="shrink-0 text-xs text-muted-foreground num">
                      {humanize(run.trigger)} · {timeAgo(run.createdAt)} · {run.steps} step{run.steps === 1 ? "" : "s"} · {formatUsdMicros(run.costMicros, tenant.locale)}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}
