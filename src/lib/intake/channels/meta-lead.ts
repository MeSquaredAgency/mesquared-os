import { decryptSecret } from "@/lib/crypto";
import { repository } from "@/lib/data";
import { processIntake } from "@/lib/intake/process";
import { intakeSchema } from "@/lib/intake/schema";
import { errorText, log } from "@/lib/log";
import type { TenantSummary } from "@/lib/types";
import { fetchMetaLead, mapMetaFieldData } from "./meta";

export interface MetaLeadRef {
  leadgenId: string;
  pageId: string;
  adId?: string | null;
  formId?: string | null;
}

export type MetaLeadOutcome = "created" | "duplicate" | "capped" | "no_token" | "invalid" | "retry_scheduled";

/** How long to wait before fetching a lead again after Graph did not answer. The tick retries twice more after that. */
const RETRY_DELAY_MS = 2 * 60_000;

/**
 * Pulls one Meta lead form submission through the normal intake pipeline.
 *
 * A paid lead must never be lost to a Graph API hiccup: when the fetch fails
 * (or the page token is missing) the lead is queued as a `meta_lead:fetch`
 * scheduled action, which the tick retries with the usual three-attempt
 * dead-letter path, and the operator sees an exception when it still fails.
 */
export async function ingestMetaLead(tenant: TenantSummary, ref: MetaLeadRef, opts: { retryOnFailure?: boolean } = {}): Promise<MetaLeadOutcome> {
  const retry = opts.retryOnFailure ?? true;
  const integration = await repository.findIntegration(tenant.id, "META");
  const token = integration?.credentialsEnc ? decryptSecret(integration.credentialsEnc, integration.id) : process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) {
    if (retry) await scheduleRetry(tenant, ref);
    await repository.createException(tenant.id, {
      reason: `A Facebook lead form submission (${ref.leadgenId}) arrived but the Meta connection has no page token, so the lead could not be read.`,
      suggestedAction: "Reconnect the Facebook page in settings; the lead is fetched automatically once it is.",
      confidence: 0.9,
    });
    return "no_token";
  }

  let fieldData: Awaited<ReturnType<typeof fetchMetaLead>>["fieldData"];
  try {
    fieldData = (await fetchMetaLead(ref.leadgenId, token)).fieldData;
  } catch (error) {
    if (!retry) throw error;
    await scheduleRetry(tenant, ref);
    log("warn", "intake.meta_lead_retry_queued", { tenantId: tenant.id, leadgenId: ref.leadgenId, error: errorText(error) });
    return "retry_scheduled";
  }

  const mapped = mapMetaFieldData(fieldData);
  const parsed = intakeSchema.safeParse({
    source: "META_LEAD_FORM",
    externalId: `meta:${ref.leadgenId}`,
    name: mapped.name,
    firstName: mapped.firstName,
    lastName: mapped.lastName,
    email: mapped.email,
    phone: mapped.phone,
    message: mapped.fields.message ?? mapped.fields.comments ?? null,
    fields: { ...mapped.fields, utm_source: "facebook", utm_medium: "lead_form", ...(ref.adId ? { utm_content: ref.adId } : {}), ...(ref.formId ? { form_id: ref.formId } : {}) },
  });
  if (!parsed.success) return "invalid";
  const result = await processIntake(tenant, parsed.data, { meta: { leadgenId: ref.leadgenId, pageId: ref.pageId, adId: ref.adId ?? null, formId: ref.formId ?? null }, field_data: fieldData }, { channel: "META_LEAD_FORM", provider: "META" });
  return result.outcome === "dry_run" ? "invalid" : result.outcome;
}

async function scheduleRetry(tenant: TenantSummary, ref: MetaLeadRef) {
  await repository.scheduleAction(tenant.id, {
    typeKey: "meta_lead",
    action: "fetch",
    runAt: new Date(Date.now() + RETRY_DELAY_MS),
    payload: { leadgenId: ref.leadgenId, pageId: ref.pageId, adId: ref.adId ?? null, formId: ref.formId ?? null },
    dedupeKey: `meta:lead:${ref.leadgenId}`,
  });
}

/** Reads a queued retry's payload back into a lead reference, or null when the payload is not one. */
export function metaLeadRefFromPayload(payload: Record<string, unknown>): MetaLeadRef | null {
  if (typeof payload.leadgenId !== "string" || typeof payload.pageId !== "string") return null;
  return { leadgenId: payload.leadgenId, pageId: payload.pageId, adId: typeof payload.adId === "string" ? payload.adId : null, formId: typeof payload.formId === "string" ? payload.formId : null };
}
