import { dataMode, repository } from "@/lib/data";
import type { TenantConfig } from "@/lib/data/repository";
import { moduleOn } from "@/lib/modules/registry";
import type { ReadinessCheck, TenantSummary } from "@/lib/types";

/**
 * The launch checklist, computed from the real state of a workspace and the
 * deployment, so "are we ready?" is never a feeling. Required items map to
 * the spec's success test: every lead answered in minutes, missed
 * opportunities visible, a week of content approvable, ad spend tied to leads.
 * Pass the tenant config when the caller already has it, to save the queries.
 */
export async function tenantReadiness(tenant: TenantSummary, knownConfig?: TenantConfig): Promise<ReadinessCheck[]> {
  const [config, people, keys, channels, adAccounts] = await Promise.all([knownConfig ?? repository.getTenantConfig(tenant.id), repository.listTenantPeople(tenant.id), repository.listApiKeys(tenant.id), repository.listChannels(tenant.id, { activeOnly: true }), repository.listAdAccounts(tenant.id, { activeOnly: true })]);
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
  add("api-key", "An intake API key is issued", "required", intakeKeys.length > 0, intakeKeys.length ? `${intakeKeys.length} active key${intakeKeys.length === 1 ? "" : "s"} (website forms and page beacon)` : "Issue a key and put it in the website form");
  // Only the workspace's own number counts: STOP replies and inbound texts are matched to the workspace by that number,
  // so texts sent from a shared platform number would leave opt-outs unrecorded.
  const smsSender = Boolean(twilio?.settings.fromNumber);
  const emailSender = Boolean(tenant.branding.replyTo) || Boolean(process.env.DEFAULT_FROM_EMAIL);
    add("messaging", "Acknowledgements can be sent", "required", (smsSender || emailSender) && process.env.MESSAGING_MODE !== "log", process.env.MESSAGING_MODE === "log" ? "MESSAGING_MODE is \"log\": nothing is sent" : smsSender && emailSender ? "SMS from the workspace's own number and a reply-to email in place" : smsSender ? "SMS only; set a reply-to email in branding" : emailSender ? "Email only; attach the workspace's own SMS number (smsNumber in provisioning) so texts and STOP replies work" : "No sender: attach an SMS number and set a reply-to email");
  add("booking", "Booking calendar connected", "recommended", connected("CALCOM"), connected("CALCOM") ? "Cal.com connected" : "Cal.com not connected; the platform booking page takes call-back requests instead");
  add("escalation", "Escalation rules name a client person", "recommended", tenant.escalationRules.length > 0, tenant.escalationRules.length ? `${tenant.escalationRules.length} rule${tenant.escalationRules.length === 1 ? "" : "s"}` : "Without rules, missed opportunities go to operators only");
  add("sla", "Service levels set", "required", tenant.sla.firstResponseMinutes > 0 && tenant.sla.bookingWindowHours > 0, `${tenant.sla.firstResponseMinutes} min to first response, ${tenant.sla.bookingWindowHours} h to book, quiet ${tenant.sla.quietHours ? `${tenant.sla.quietHours.start}:00–${tenant.sla.quietHours.end}:00` : "by region"}`);
  add("channels", "Social channels connected", "recommended", channels.length > 0, channels.length ? channels.map((c) => c.platform.toLowerCase().replace("_", " ")).join(", ") : "Connect at least one channel for the content engine to draft for");
  const footer = config.brand?.complianceBlock.requiredFooter?.trim();
  add("footer", "Compliance footer set", tenant.industry === "REAL_ESTATE" ? "required" : "optional", Boolean(footer), footer ? `"${footer}"` : "Every asset must carry the licence line for a real-estate business");
  add("content-engine", "Content engine on", "recommended", config.automations.some((a) => a.typeKey === "content_engine" && a.enabled), process.env.ANTHROPIC_API_KEY ? "Claude drafts" : "Drafting with the stub; add ANTHROPIC_API_KEY for Claude");
  add("ads", "Ad accounts connected with budgets", "recommended", adAccounts.length > 0 && adAccounts.every((a) => (a.monthlyBudgetCents ?? 0) > 0), adAccounts.length ? `${adAccounts.length} account${adAccounts.length === 1 ? "" : "s"}${adAccounts.some((a) => !a.monthlyBudgetCents) ? ", some without a budget" : ""}` : "Connect Meta and Google Ads to tie spend to leads");
  add("finance", "Finance provider connected", "optional", ["SQUARE", "STRIPE", "XERO", "QUICKBOOKS"].some(connected), ["SQUARE", "STRIPE", "XERO", "QUICKBOOKS"].filter(connected).join(", ") || "Revenue stays at pipeline value until one is connected");
  add("website", "Website forms and beacon", "recommended", Boolean(integration("WEBSITE")) || intakeKeys.length > 0, integration("WEBSITE") ? `Domain ${String(integration("WEBSITE")!.externalAccountId ?? "")} on file` : "Add the form key and the page beacon to the site");
  const inventoryOn = moduleOn(config.modules, "inventory");
  const pm = integration("PROPERTY_MANAGEMENT");
  add("inventory", "Inventory (listings) on when the business tracks stock", "optional", inventoryOn, inventoryOn ? (pm?.status === "CONNECTED" ? `Inventory module on; ${pm.label ?? "property management software"} connected, synced daily` : "Inventory module on; import a CSV or connect the property management software") : "Off; switch on for listings, rent roll or stock");
  return checks;
}

/** Deployment-level items that apply to every workspace. */
export function platformReadiness(env: Record<string, string | undefined> = process.env, live: { lastTickAt?: Date | null; now?: Date } = {}): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];
  const add = (key: string, label: string, level: ReadinessCheck["level"], ok: boolean, detail: string) => checks.push({ key, label, level, ok, detail });
  const production = env.NODE_ENV === "production";
  const publicUrl = env.NEXT_PUBLIC_APP_URL && /^https:\/\//.test(env.NEXT_PUBLIC_APP_URL) && !/localhost|127\.0\.0\.1/.test(env.NEXT_PUBLIC_APP_URL);
  add("database", "Database connected", "required", dataMode === "postgres", dataMode === "postgres" ? "Postgres" : "Demo mode: nothing persists");
  add("auth-secret", "AUTH_SECRET set", "required", Boolean(env.AUTH_SECRET && env.AUTH_SECRET.length >= 32), env.AUTH_SECRET ? "set" : "Sessions are signed with the development fallback");
  add("encryption-key", "INTEGRATION_ENCRYPTION_KEY set", "required", Boolean(env.INTEGRATION_ENCRYPTION_KEY && env.INTEGRATION_ENCRYPTION_KEY.length >= 24), env.INTEGRATION_ENCRYPTION_KEY ? "set" : "Credentials would be encrypted with the development key");
  add("job-secret", "JOB_SECRET set", "required", Boolean(env.JOB_SECRET), env.JOB_SECRET ? "set" : "The scheduler cannot authenticate");
  if (live.lastTickAt !== undefined) {
    const ageMs = live.lastTickAt ? (live.now ?? new Date()).getTime() - live.lastTickAt.getTime() : null;
    add("tick-recent", "The scheduler ticked in the last five minutes", "required", ageMs !== null && ageMs < 5 * 60_000, ageMs === null ? "No tick recorded yet" : `last tick ${Math.round(ageMs / 1000)} s ago`);
  }
  add("from-email", "Platform from-address set", "required", Boolean(env.DEFAULT_FROM_EMAIL), env.DEFAULT_FROM_EMAIL ? env.DEFAULT_FROM_EMAIL : "DEFAULT_FROM_EMAIL unset: email would go from each workspace's reply-to, which the email provider rejects for an unverified domain");
  add("twilio-webhook-url", "Twilio webhook URL matches the public URL", env.TWILIO_ACCOUNT_SID ? "required" : "optional", !env.TWILIO_ACCOUNT_SID || Boolean(env.TWILIO_WEBHOOK_URL && env.NEXT_PUBLIC_APP_URL && env.TWILIO_WEBHOOK_URL.startsWith(env.NEXT_PUBLIC_APP_URL.replace(/\/$/, ""))), env.TWILIO_WEBHOOK_URL ? (env.NEXT_PUBLIC_APP_URL && env.TWILIO_WEBHOOK_URL.startsWith(env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")) ? "set" : "TWILIO_WEBHOOK_URL is on a different host from NEXT_PUBLIC_APP_URL; inbound SMS signatures would fail") : "TWILIO_WEBHOOK_URL unset; set it to <public URL>/api/v1/inbound/sms");
  add("public-url", "Public app URL", "required", Boolean(publicUrl), env.NEXT_PUBLIC_APP_URL ?? "unset: booking links, alerts and webhooks point at localhost");
  add("messaging-live", "Messaging is live (not log mode)", "required", env.MESSAGING_MODE !== "log" && Boolean(env.TWILIO_ACCOUNT_SID || env.RESEND_API_KEY), env.MESSAGING_MODE === "log" ? "MESSAGING_MODE=log" : env.TWILIO_ACCOUNT_SID || env.RESEND_API_KEY ? "Twilio and/or Resend configured" : "No provider credentials");
  add("social-live", "Social publishing is live (not log mode)", "recommended", env.SOCIAL_MODE !== "log", env.SOCIAL_MODE === "log" ? "SOCIAL_MODE=log" : "live");
    add("ads-finance-live", "Ads, finance and inventory pulls are live (not log mode)", "recommended", env.ADS_MODE !== "log" && env.FINANCE_MODE !== "log" && env.INVENTORY_MODE !== "log", [env.ADS_MODE === "log" ? "ADS_MODE=log" : null, env.FINANCE_MODE === "log" ? "FINANCE_MODE=log" : null, env.INVENTORY_MODE === "log" ? "INVENTORY_MODE=log" : null].filter(Boolean).join(", ") || "live");
  add("google-sign-in", "Google sign-in available", "recommended", Boolean(env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET), env.GOOGLE_OAUTH_CLIENT_ID && env.GOOGLE_OAUTH_CLIENT_SECRET ? "Continue with Google is on the sign-in page" : "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET so people can sign in without a password");
  add("claude", "Claude key for qualification and drafting", "recommended", Boolean(env.ANTHROPIC_API_KEY), env.ANTHROPIC_API_KEY ? "set" : "Rule-based qualification and the drafting stub are in use");
    const webhookSecrets = ["META_APP_SECRET", "META_WEBHOOK_VERIFY_TOKEN", "CALCOM_WEBHOOK_SECRET", "INBOUND_EMAIL_SECRET", "TWILIO_AUTH_TOKEN"];
  const missingSecrets = webhookSecrets.filter((k) => !env[k]);
  add("webhook-secrets", "Webhook secrets set", production ? "required" : "recommended", missingSecrets.length === 0, missingSecrets.length ? `${missingSecrets.join(", ")} missing${production ? "; in production those channels return 503 and their leads are lost" : ""}` : "all set");
  return checks;
}

export function readinessSummary(checks: ReadinessCheck[]): { requiredPassed: number; requiredTotal: number; ready: boolean } {
  const required = checks.filter((c) => c.level === "required");
  const passed = required.filter((c) => c.ok).length;
  return { requiredPassed: passed, requiredTotal: required.length, ready: passed === required.length };
}
