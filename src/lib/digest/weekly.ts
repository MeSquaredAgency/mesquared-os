import { AUTOMATION_BY_KEY } from "@/lib/automations/registry";
import { repository } from "@/lib/data";
import type { TenantConfig } from "@/lib/data/repository";
import { emit } from "@/lib/events";
import { log } from "@/lib/log";
import { sendMessage, templates } from "@/lib/messaging";
import type { TenantSummary } from "@/lib/types";
import { startOfDayInZone } from "@/lib/utils";

/**
 * Whether an automation is on for a tenant, with the registry default standing
 * in for a workspace provisioned before the type existed.
 */
export function automationState(config: TenantConfig, key: string): { enabled: boolean; settings: Record<string, unknown> } {
  const row = config.automations.find((a) => a.typeKey === key);
  return row ? { enabled: row.enabled, settings: row.settings } : { enabled: AUTOMATION_BY_KEY[key]?.defaultEnabled ?? false, settings: {} };
}

/** Monday 00:00 of the week that contains `now`, in the tenant's zone; the digest covers the seven days before it. */
export function weekBounds(timezone: string, locale: string, now: Date): { start: Date; end: Date; label: string } {
  const today = startOfDayInZone(timezone, now);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(now);
  const daysSinceMonday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(weekday);
  const end = new Date(today.getTime() - Math.max(0, daysSinceMonday) * 86_400_000);
  const start = new Date(end.getTime() - 7 * 86_400_000);
  const fmt = (d: Date) => d.toLocaleDateString(locale, { timeZone: timezone, day: "numeric", month: "long" });
  return { start, end, label: `${fmt(start)} – ${fmt(new Date(end.getTime() - 1))}` };
}

/**
 * The Monday email. Owners and managers (anyone who may see finances or
 * manage users) get the week in plain sentences; people who may not see
 * finances get the same email without the money line. Sent once per
 * workspace per week by the scheduler; nothing goes out when nobody is a
 * member yet.
 */
export async function sendWeeklyDigest(tenant: TenantSummary, now = new Date()): Promise<{ sent: number; skipped: string | null }> {
  const config = await repository.getTenantConfig(tenant.id);
  if (!automationState(config, "weekly_digest").enabled) return { sent: 0, skipped: "off" };
  const people = (await repository.listTenantPeople(tenant.id)).filter((p) => p.via === "member" && (p.permissions.includes("VIEW_FINANCES") || p.permissions.includes("MANAGE_USERS")));
  if (people.length === 0) return { sent: 0, skipped: "nobody to send to" };

  const { start, end, label } = weekBounds(tenant.timezone, tenant.locale, now);
  const [home, leads, closed] = await Promise.all([
    repository.getPortalHome(tenant.id, { timezone: tenant.timezone, currency: tenant.currency, onlyAssigneeId: null, canViewFinances: true }),
    repository.listLeadsBetween(tenant.id, start, end, 5000),
    repository.listMissedOpportunities(tenant.id, { status: ["RECOVERED"], limit: 500 }),
  ]);
  const recoveredThisWeek = closed.filter((m) => m.resolvedAt && m.resolvedAt >= start && m.resolvedAt < end);
  const portalUrl = `${(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/app/${tenant.slug}`;

  let sent = 0;
  for (const person of people) {
    const canSeeMoney = person.permissions.includes("VIEW_FINANCES");
    const mail = templates.weeklyDigestEmail({
      tenant,
      firstName: person.name?.trim().split(/\s+/)[0] ?? null,
      weekLabel: label,
      leads: leads.length,
      needsYou: home.needsYou.length,
      recovered: { count: recoveredThisWeek.length, cents: recoveredThisWeek.reduce((s, m) => s + m.recoveredValueCents, 0) },
      atRisk: { count: home.missed.open.length, cents: home.missed.atRiskCents },
      handled: home.handled.countWeek,
      money: canSeeMoney && home.money ? { revenueCents: home.money.revenueMonthCents, adSpendCents: home.money.adSpendMonthCents, costPerLeadCents: home.money.costPerLeadCents } : null,
      portalUrl,
    });
    const result = await sendMessage({ tenant, contactId: null, channel: "EMAIL", to: person.email, body: mail.body, subject: mail.subject, transactional: true });
    if (result.ok) sent++;
    else if (!result.simulated) log("warn", "digest.send_failed", { tenantId: tenant.id, error: result.error ?? null });
  }
  if (sent > 0) {
    await repository.recordAutomationRun(tenant.id, { typeKey: "weekly_digest", outcome: "SENT", summary: `Sent the weekly summary (${label}) to ${sent === 1 ? (people[0].name ?? "one person") : `${sent} people`}.` });
    await emit(tenant.id, "digest.sent", { week: label, recipients: sent });
  } else {
    await repository.recordAutomationRun(tenant.id, { typeKey: "weekly_digest", outcome: "SKIPPED", summary: `The weekly summary for ${label} could not be sent: email isn't connected for ${tenant.name} yet.` });
  }
  return { sent, skipped: sent === 0 ? "email not connected" : null };
}
