import type { NextRequest } from "next/server";
import { hashApiKey } from "@/lib/crypto";
import { repository } from "@/lib/data";
import type { ApiKeyScope } from "@/lib/data/repository";
import type { TenantSummary } from "@/lib/types";

export type TenantResolution =
  | { ok: true; tenant: TenantSummary; apiKeyId: string | null; scopes: ApiKeyScope[] }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Authenticates an inbound API request to a tenant.
 *
 * Accepts `Authorization: Bearer <key>` or `x-api-key: <key>`. The key is
 * hashed and matched against TenantApiKey rows; the raw key is never stored.
 *
 * Keys carry scopes. "intake" keys are pasted into public web forms by
 * design, so anything beyond receiving enquiries (uploading files, reading
 * the content library) needs a key with the "content" scope.
 */
export async function resolveTenantFromRequest(req: NextRequest, scope: ApiKeyScope = "intake"): Promise<TenantResolution> {
  const auth = req.headers.get("authorization");
  const bearer = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const raw = bearer ?? req.headers.get("x-api-key")?.trim() ?? null;

  if (!raw) {
    return { ok: false, status: 401, error: "Missing API key. Send Authorization: Bearer <key> or x-api-key." };
  }

  const match = await repository.findTenantByApiKeyHash(hashApiKey(raw));
  if (!match) return { ok: false, status: 403, error: "Invalid or revoked API key." };
  if (!match.scopes.includes(scope)) return { ok: false, status: 403, error: `This API key cannot be used for ${scope}; it needs the "${scope}" scope.` };
  return { ok: true, tenant: match.tenant, apiKeyId: match.apiKeyId, scopes: match.scopes };
}
