import type { NextRequest } from "next/server";
import { hashApiKey } from "@/lib/crypto";
import { repository } from "@/lib/data";
import type { TenantSummary } from "@/lib/types";

export type TenantResolution =
  | { ok: true; tenant: TenantSummary; apiKeyId: string | null }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Authenticates an inbound API request to a tenant.
 *
 * Accepts `Authorization: Bearer <key>` or `x-api-key: <key>`. The key is
 * hashed and matched against TenantApiKey rows; the raw key is never stored.
 */
export async function resolveTenantFromRequest(req: NextRequest): Promise<TenantResolution> {
  const auth = req.headers.get("authorization");
  const bearer = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const raw = bearer ?? req.headers.get("x-api-key")?.trim() ?? null;

  if (!raw) {
    return { ok: false, status: 401, error: "Missing API key. Send Authorization: Bearer <key> or x-api-key." };
  }

  const match = await repository.findTenantByApiKeyHash(hashApiKey(raw));
  if (!match) return { ok: false, status: 403, error: "Invalid or revoked API key." };
  return { ok: true, tenant: match.tenant, apiKeyId: match.apiKeyId };
}
