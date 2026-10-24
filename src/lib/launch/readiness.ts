import { dataMode, repository } from "@/lib/data";
import type { ReadinessCheck, TenantSummary } from "@/lib/types";

/**
 * The launch checklist, computed from the real state of a workspace and the
 * deployment, so "are we ready?" is never a feeling. Required items map to
 * the spec's success test: every lead answered in minutes, missed
 * opportunities visible, a week of content approvable, ad spend tied to leads.
 */
export async function tenantReadiness(tenant: TenantSummary): Promise<ReadinessCheck[]> {
  const [config, people, keys, channels, adAccounts] = await Promise.all([repository.getTenantConfig(tenant.id), repository.listTenantPeople(tenant.id), repository.listApiKeys(tenant.id), repository.listChannels(tenant.id, { activeOnly: true }), repository.listAdAccounts(tenant.id, { activeOnly: true })]);
  const integration = (p: string) => config.integrations.find((i) => i.provider === p);
  const connected = (p: string) => integration(p)?.status === "CONNECTED";
  const twilio = await repository.findIntegration(tenant.id, "TWILIO");
  const checks: ReadinessCheck[] = [];
  const add = (key: string, label: string, level: ReadinessCheck["level"], ok: boolean, detail: string) => checks.push({ key, label, level, ok, detail });

  add("template", "Set up from a template", "required", Boolean(tenant.templateKey) && config.roles.length > 0 && config.pipelines.length > 0, tenant.templateKey ? `${tenant.templateKey.replace(/_/g, " ")} template, ${config.roles.length} roles, ${config.pipelines.length} pipeline${config.pipelines.length === 1 ? "" : "s"}` : "No template applied");
  const alertPeople = people.filter((p) => p.permissions.includes("RECEIVE_LEAD_ALERTS"));
  add("alerts", "Someone receives lead alerts", "required", alertPeople.length > 0, alertPeople.length ? alertPeople.map((p) => p.name ?? p.email).join(", ") : "Invite a member whose role includes lead alerts");
  add("operator", "An operator is assigned", "required", people.some((p) => p.via === "operator"), people.some((p) => p.via === "operator") ? people.filter((p) => p.via === "operator").map((p) => p.name ?? p.email).join(", ") : "Assign a Me² operator so exceptions reach a person");
  const intakeKeys = keys.filter((k) => !k.revokedAt && k.scopes.includes("intake"));
  add("api-key", "An intake API key is issued", "required", intakeKeys.length > 0, intakeKeys.length ? `${intakeKeys.length} active key${intakeKeys.length === 1 ? "" : "s"} (website forms, call tracking, reviews)` : "Issue a key and put it in the website form");
  const smsSender = Boolean(twilio?.settings.fromNumber) || Boolean(process.env.DEFAULT_FROM_NUMBER);
  const emailSender = Boolean(tenant.branding.replyTo) || Boolean(process.env.DEFAULT_FROM_EMAIL);
  add("messaging", "Acknowledgements can be sent", "required", (smsSender || emailSender) && process.env.MESSAGING_MODE !== "log", process.env.MESSAGING_MODE === "log" ? "MESSAGING_MODE is \"log\": nothing is sent" : smsSender && emailSender ? "SMS number and reply-to email in place" : smsSender ? "SMS only; set a reply-to email in branding" : emailSender ? "Email only; connect Twilio for SMS" : "No sender: connect Twilio and set a reply-to email");
  add("booking", "Booking link works", "required", connected("CALCOM") || true, connected("CALCOM") ? "Cal.com connected" : "Cal.com not connected; the platform booking page takes call-back requests instead");
  add("escalation", "Escalation rules name a client person", "recommended", tenant.escalationRules.length > 0, tenant.escalationRules.length ? `${tenant.escalationRules.length} rule${tenant.escalationRules.length === 1 ? "" : "s"}` : "Without rules, missed opportunities go to operators only");
  add("sla", "Service levels set", "required", tenant.sla.firstResponseMinutes > 0 && tenant.sla.bookingWindowHours > 0, `${tenant.sla.firstResponseMinutes} min to first response, ${tenant.sla.bookingWindowHours} h to book, quiet ${tenant.sla.quietHours ? `${tenant.sla.quietHours.start}:00–${tenant.sla.quietHours.end}:00` : "by region"}`);
  add("channels", "Social channels connected", "recommended", channels.length > 0, channels.length ? channels.map((c) => c.platform.toLowerCase().replace("_", " ")).join(", ") : "Connect at least one channel for the content engine to draft for");
  const footer = config.brand?.complianceBlock.requiredFooter?.trim();
  add("footer", "Compliance footer set", tenant.industry === "REAL_ESTATE" ? "required" : "optional", Boolean(footer), footer ? `"${footer}"` : "Every asset must carry the licence line for a real-estate business");
  add("content-engine", "Content engine on", "recommended", config.automations.some((a) => a.typeKey === "content_engine" && a.enabled), process.env.ANTHROPIC_API_KEY ? "Claude drafts" : "Drafting with the stub; add ANTHROPIC_API_KEY for Claude");
  add("ads", "Ad accounts connected with budgets", "recommended", adAccounts.length > 0 && adAccounts.every((a) => (a.monthlyBudgetCents ?? 0) > 0), adAccounts.length ? `${adAccounts.length} account${adAccounts.length === 1 ? "" : "s"}${adAccounts.some((a) => !a.monthlyBudgetCents) ? ", some without a budget" : ""}` : "Connect Meta and Google Ads to tie spend to leads");
  add("finance", "Finance provider connected", "optional", ["SQUARE", "STRIPE", "XERO", "QUICKBOOKS"].some(connected), ["SQUARE", "STRIPE", "XERO", "QUICKBOOKS"].filter(connected).join(", ") || "Revenue stays at pipeline value until one is connected");
  add("website", "Website forms and beacon", "recommended", Boolean(integration("WEBSITE")) || intakeKeys.length > 0, integration("WEBSITE") ? `Domain ${String(integration("WEBSITE")!.externalAccountId ?? "")} on file` : "Add the form key and the page beacon to the site");
  add("inventory", "Inventory (listings) on when the business tracks stock", "optional", config.modules.some((m) => m.moduleKey === "inventory" && m.enabled), config.modules.some((m) => m.moduleKey === "inventory" && m.enabled) ? "Inventory module on" : "Off; switch on for listings, rent roll or stock");
  return checks;
}

/** Deployment-level items that apply to every workspace. */
export function platformReadiness(env: Record<string, string | undefined> = process.env): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];
  const add = (key: string, label: string, level: ReadinessCheck["level"], ok: boolean, detail: string) => checks.push({ key, label, level, ok, detail });
  const publicUrl = env.NEXT_PUBLIC_APP_URL && /^https:\/\//.test(env.NEXT_PUBLIC_APP_URL) && !/localhost|127\.0\.0\.1/.test(env.NEXT_PUBLIC_APP_URL);
  add("database", "Database connected", "required", dataMode === "postgres", dataMode === "postgres" ? "Postgres" : "Demo mode: nothing persists");
  add("auth-secret", "AUTH_SECRET set", "required", Boolean(env.AUTH_SECRET && env.AUTH_SECRET.length >= 32), env.AUTH_SECRET ? "set" : "Sessions are signed with the development fallback");
  add("encryption-key", "INTEGRATION_ENCRYPTION_KEY set", "required", Boolean(env.INTEGRATION_ENCRYPTION_KEY && env.INTEGRATION_ENCRYPTION_KEY.length >= 24), env.INTEGRATION_ENCRYPTION_KEY ? "set" : "Credentials would be encrypted with the development key");
  add("job-secret", "JOB_SECRET set and the tick runs every minute", "required", Boolean(env.JOB_SECRET), env.JOB_SECRET ? "set; confirm the scheduler is calling /api/jobs/tick" : "The scheduler cannot authenticate");
  add("public-url", "Public app URL", "required", Boolean(publicUrl), env.NEXT_PUBLIC_APP_URL ?? "unset: booking links, alerts and webhooks point at localhost");
  add("messaging-live", "Messaging is live (not log mode)", "required", env.MESSAGING_MODE !== "log" && Boolean(env.TWILIO_ACCOUNT_SID || env.RESEND_API_KEY), env.MESSAGING_MODE === "log" ? "MESSAGING_MODE=log" : env.TWILIO_ACCOUNT_SID || env.RESEND_API_KEY ? "Twilio and/or Resend configured" : "No provider credentials");
  add("social-live", "Social publishing is live (not log mode)", "recommended", env.SOCIAL_MODE !== "log", env.SOCIAL_MODE === "log" ? "SOCIAL_MODE=log" : "live");
  add("ads-finance-live", "Ads and finance pulls are live (not log mode)", "recommended", env.ADS_MODE !== "log" && env.FINANCE_MODE !== "log", [env.ADS_MODE === "log" ? "ADS_MODE=log" : null, env.FINANCE_MODE === "log" ? "FINANCE_MODE=log" : null].filter(Boolean).join(", ") || "live");
  add("claude", "Claude key for qualification and drafting", "recommended", Boolean(env.ANTHROPIC_API_KEY), env.ANTHROPIC_API_KEY ? "set" : "Rule-based qualification and the drafting stub are in use");
  add("webhook-secrets", "Webhook secrets set", "recommended", Boolean(env.META_APP_SECRET && env.CALCOM_WEBHOOK_SECRET && env.INBOUND_EMAIL_SECRET && env.TWILIO_AUTH_TOKEN), ["META_APP_SECRET", "CALCOM_WEBHOOK_SECRET", "INBOUND_EMAIL_SECRET", "TWILIO_AUTH_TOKEN"].filter((k) => !env[k]).map((k) => `${k} missing`).join(", ") || "all set");
  return checks;
}

export function readinessSummary(checks: ReadinessCheck[]): { requiredPassed: number; requiredTotal: number; ready: boolean } {
  const required = checks.filter((c) => c.level === "required");
  const passed = required.filter((c) => c.ok).length;
  return { requiredPassed: passed, requiredTotal: required.length, ready: passed === required.length };
}
