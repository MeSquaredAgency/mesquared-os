import { repository } from "@/lib/data";
import type { SiteMetricSnapshotRecord, TenantSummary, WebEventRecord } from "@/lib/types";

/**
 * Website numbers from the site beacon (/api/v1/track/page) and the form
 * endpoints: rolled up once a day into SiteMetricSnapshot, raw events pruned
 * after 35 days. No third-party analytics needed; GA4 can be added later as
 * another source.
 */

function topN(counts: Map<string, number>, n = 10): Record<string, number> {
  return Object.fromEntries(Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, n));
}

export function summarizeEvents(events: WebEventRecord[]): Omit<SiteMetricSnapshotRecord, "id" | "tenantId" | "date"> {
  const sessions = new Set<string>();
  const pages = new Map<string, number>();
  const sources = new Map<string, number>();
  let pageviews = 0;
  let formStarts = 0;
  let formSubmits = 0;
  let linkClicks = 0;
  const sessionSource = new Map<string, string>();
  for (const e of events) {
    const session = e.sessionKey ?? e.id;
    if (e.kind === "PAGEVIEW") {
      pageviews++;
      sessions.add(session);
      if (e.path) pages.set(e.path, (pages.get(e.path) ?? 0) + 1);
      if (!sessionSource.has(session)) {
        let src = e.source?.toLowerCase() || null;
        if (!src && e.referrer) {
          try {
            src = `(referral) ${new URL(e.referrer).hostname.replace(/^www\./, "")}`;
          } catch {
            src = "(referral)";
          }
        }
        sessionSource.set(session, src ?? "direct");
      }
    } else if (e.kind === "FORM_START") formStarts++;
    else if (e.kind === "FORM_SUBMIT") formSubmits++;
    else if (e.kind === "LINK_CLICK") linkClicks++;
  }
  for (const src of sessionSource.values()) sources.set(src, (sources.get(src) ?? 0) + 1);
  return { sessions: sessions.size, pageviews, formStarts, formSubmits, linkClicks, topPages: topN(pages), topSources: topN(sources) };
}

/** Rolls up one UTC day (yesterday by default) and prunes old raw events. */
export async function rollupSite(tenant: TenantSummary, day = new Date(Date.now() - 86_400_000)): Promise<{ date: Date; pageviews: number }> {
  const start = new Date(`${day.toISOString().slice(0, 10)}T00:00:00Z`);
  const end = new Date(start.getTime() + 86_400_000);
  const events = await repository.listWebEvents(tenant.id, start, end);
  const summary = summarizeEvents(events);
  await repository.recordSiteMetrics(tenant.id, { date: start, ...summary });
  await repository.pruneWebEvents(tenant.id, new Date(Date.now() - 35 * 86_400_000));
  return { date: start, pageviews: summary.pageviews };
}

export interface SiteSummary {
  sessions7d: number;
  pageviews7d: number;
  formStarts7d: number;
  formSubmits7d: number;
  /** Submissions as a share of starts, 0–1, or null without starts. */
  formConversion: number | null;
  sessionsChange: number | null;
  topPages: Record<string, number>;
  topSources: Record<string, number>;
  days: SiteMetricSnapshotRecord[];
}

export function summarizeSite(snapshots: SiteMetricSnapshotRecord[], now = new Date()): SiteSummary {
  const weekAgo = now.getTime() - 7 * 86_400_000;
  const twoWeeksAgo = now.getTime() - 14 * 86_400_000;
  const week = snapshots.filter((s) => s.date.getTime() >= weekAgo);
  const prior = snapshots.filter((s) => s.date.getTime() >= twoWeeksAgo && s.date.getTime() < weekAgo);
  const sum = (rows: SiteMetricSnapshotRecord[], k: "sessions" | "pageviews" | "formStarts" | "formSubmits") => rows.reduce((n, r) => n + r[k], 0);
  const merge = (rows: SiteMetricSnapshotRecord[], k: "topPages" | "topSources") => {
    const m = new Map<string, number>();
    for (const r of rows) for (const [key, v] of Object.entries(r[k])) m.set(key, (m.get(key) ?? 0) + v);
    return topN(m, 8);
  };
  const sessions7d = sum(week, "sessions");
  const priorSessions = sum(prior, "sessions");
  const starts = sum(week, "formStarts");
  const submits = sum(week, "formSubmits");
  return {
    sessions7d,
    pageviews7d: sum(week, "pageviews"),
    formStarts7d: starts,
    formSubmits7d: submits,
    formConversion: starts > 0 ? Math.min(1, submits / starts) : null,
    sessionsChange: priorSessions > 0 ? Math.round(((sessions7d - priorSessions) / priorSessions) * 100) : null,
    topPages: merge(week, "topPages"),
    topSources: merge(week, "topSources"),
    days: snapshots,
  };
}
