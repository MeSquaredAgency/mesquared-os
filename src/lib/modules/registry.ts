import type { IntegrationProvider, TenantModuleRecord } from "@/lib/types";

/**
 * Platform modules a tenant can switch on. Keys are stable identifiers stored
 * on TenantModule rows; everything else here is presentation and the
 * integrations each module can use.
 */
export interface ModuleDefinition {
  key: string;
  name: string;
  description: string;
  /** Switched on for every new tenant unless the template says otherwise. */
  defaultEnabled: boolean;
  integrations: IntegrationProvider[];
}

export const MODULES: ModuleDefinition[] = [
  { key: "leads", name: "Leads & CRM", description: "Intake, qualification, pipelines and the response playbook.", defaultEnabled: true, integrations: ["CALCOM", "GOOGLE_CALENDAR", "OUTLOOK_CALENDAR", "TWILIO", "RESEND", "WHATSAPP"] },
  { key: "opportunities", name: "Missed opportunities", description: "Spots leads and customers slipping away, puts a value on the risk and shows what came back. Off, the client sees no missed-opportunities page or money figures; the response watch still chases the team.", defaultEnabled: true, integrations: ["CALL_TRACKING"] },
  { key: "automation", name: "Admin automation", description: "Reusable automations with an operator exception queue.", defaultEnabled: true, integrations: ["TWILIO", "RESEND", "WHATSAPP", "EMAIL_FORWARDING"] },
  { key: "content", name: "Content engine", description: "Turns raw material into per-channel assets under brand and compliance rules.", defaultEnabled: true, integrations: [] },
  { key: "social", name: "Social", description: "Publishing, calendar, unified inbox and analytics across channels.", defaultEnabled: true, integrations: ["META", "TIKTOK", "YOUTUBE", "LINKEDIN", "GOOGLE_BUSINESS"] },
  { key: "ads", name: "Ads & attribution", description: "Spend, results and cost per lead across ad platforms.", defaultEnabled: false, integrations: ["META", "GOOGLE_ADS"] },
  { key: "finance", name: "Finance", description: "Revenue, invoices and a simple P&L from connected providers.", defaultEnabled: false, integrations: ["SQUARE", "STRIPE", "XERO", "QUICKBOOKS"] },
  { key: "website", name: "Website", description: "Forms into intake, tracking into attribution, pages from the engine.", defaultEnabled: false, integrations: ["WEBSITE"] },
  { key: "inventory", name: "Inventory", description: "Listings, capacity or stock, where a business has something to track.", defaultEnabled: false, integrations: ["PROPERTY_MANAGEMENT", "REA", "DOMAIN"] },
];

export const MODULE_BY_KEY: Record<string, ModuleDefinition> = Object.fromEntries(MODULES.map((m) => [m.key, m]));

/** Whether a module is switched on for a workspace. A module with no row is off. */
export const moduleOn = (modules: Pick<TenantModuleRecord, "moduleKey" | "enabled">[], key: string): boolean => modules.some((m) => m.moduleKey === key && m.enabled);
