import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Meta (Facebook/Instagram) lead-form webhook handling. Verification, event
 * parsing and the Graph API fetch are separated so each can be tested with
 * recorded payloads.
 */

export interface MetaLeadgenEvent {
  pageId: string;
  leadgenId: string;
  formId: string | null;
  adId: string | null;
  createdTime: number | null;
}

export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const given = header.slice("sha256=".length);
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

export function parseMetaLeadgenEvents(body: unknown): MetaLeadgenEvent[] {
  const out: MetaLeadgenEvent[] = [];
  const root = body as { object?: string; entry?: { id?: string; changes?: { field?: string; value?: Record<string, unknown> }[] }[] };
  if (root?.object !== "page" || !Array.isArray(root.entry)) return out;
  for (const entry of root.entry) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "leadgen" || !change.value) continue;
      const v = change.value;
      const leadgenId = typeof v.leadgen_id === "string" || typeof v.leadgen_id === "number" ? String(v.leadgen_id) : null;
      const pageId = typeof v.page_id === "string" || typeof v.page_id === "number" ? String(v.page_id) : entry.id ? String(entry.id) : null;
      if (!leadgenId || !pageId) continue;
      out.push({
        pageId,
        leadgenId,
        formId: v.form_id != null ? String(v.form_id) : null,
        adId: v.ad_id != null ? String(v.ad_id) : null,
        createdTime: typeof v.created_time === "number" ? v.created_time : null,
      });
    }
  }
  return out;
}

export interface MetaLeadFields {
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  fields: Record<string, string>;
}

/** Maps Graph API `field_data` to the intake shape. Custom questions go into `fields` by their key. */
export function mapMetaFieldData(fieldData: { name?: string; values?: unknown[] }[] | undefined): MetaLeadFields {
  const out: MetaLeadFields = { name: null, firstName: null, lastName: null, email: null, phone: null, fields: {} };
  for (const f of fieldData ?? []) {
    const key = (f.name ?? "").toLowerCase();
    const value = Array.isArray(f.values) && f.values.length ? String(f.values[0]) : "";
    if (!key || !value) continue;
    if (key === "full_name") out.name = value;
    else if (key === "first_name") out.firstName = value;
    else if (key === "last_name") out.lastName = value;
    else if (key === "email") out.email = value;
    else if (key === "phone_number" || key === "phone") out.phone = value;
    else out.fields[key] = value.slice(0, 500);
  }
  return out;
}

/** Fetches a lead's answers from the Graph API with the page's access token. */
export async function fetchMetaLead(leadgenId: string, pageAccessToken: string): Promise<{ fieldData: { name?: string; values?: unknown[] }[]; createdTime: string | null }> {
  const url = new URL(`https://graph.facebook.com/v21.0/${leadgenId}`);
  url.searchParams.set("fields", "created_time,field_data,ad_id,form_id");
  url.searchParams.set("access_token", pageAccessToken);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Graph API ${res.status} fetching lead ${leadgenId}`);
  const json = (await res.json()) as { field_data?: { name?: string; values?: unknown[] }[]; created_time?: string };
  return { fieldData: json.field_data ?? [], createdTime: json.created_time ?? null };
}
