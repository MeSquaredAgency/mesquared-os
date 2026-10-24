import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, it } from "node:test";
import { aiGatewayConfig, databaseName, neonServices } from "@/lib/neon";
import { qualifierEngine } from "@/lib/qualify";
import { createAnthropicQualifier } from "@/lib/qualify/anthropic";
import { leadsLiveQuery, toLiveLeadRow } from "@/lib/realtime/server";
import { fileUrlFromKey, storageKeyFromFileUrl, tenantObjectKey, tenantOwnsKey } from "@/lib/storage";
import type { LeadRecord } from "@/lib/types";
import neonConfig from "../../neon.ts";

const NEON_KEYS = [
  "DATABASE_URL",
  "NEON_AI_GATEWAY_BASE_URL",
  "NEON_AI_GATEWAY_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_ENDPOINT_URL_S3",
  "NEON_REALTIME_URL",
  "NEON_REALTIME_SECRET",
  "ANTHROPIC_API_KEY",
  "QUALIFIER_ENGINE",
] as const;

function envWith(values: Partial<Record<(typeof NEON_KEYS)[number], string>>): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {};
  for (const key of NEON_KEYS) if (values[key] !== undefined) env[key] = values[key];
  return env;
}

describe("neon service detection", () => {
  it("reports nothing configured with an empty environment", () => {
    assert.deepEqual(neonServices({}), { postgres: false, aiGateway: false, objectStorage: false, realtime: false });
    assert.equal(aiGatewayConfig({}), null);
  });

  it("needs both halves of a credential pair, and Postgres for Realtime", () => {
    assert.equal(neonServices(envWith({ NEON_AI_GATEWAY_BASE_URL: "https://gw" })).aiGateway, false);
    assert.equal(neonServices(envWith({ NEON_REALTIME_URL: "wss://rt", NEON_REALTIME_SECRET: "s" })).realtime, false);
    const full = neonServices(
      envWith({
        DATABASE_URL: "postgresql://u:p@h-pooler.neon.tech/neondb",
        NEON_AI_GATEWAY_BASE_URL: "https://gw/",
        NEON_AI_GATEWAY_TOKEN: "nt_live_x",
        AWS_ACCESS_KEY_ID: "a",
        AWS_SECRET_ACCESS_KEY: "b",
        AWS_ENDPOINT_URL_S3: "https://s3",
        NEON_REALTIME_URL: "wss://rt",
        NEON_REALTIME_SECRET: "s",
      }),
    );
    assert.deepEqual(full, { postgres: true, aiGateway: true, objectStorage: true, realtime: true });
    assert.deepEqual(aiGatewayConfig(envWith({ NEON_AI_GATEWAY_BASE_URL: "https://gw/", NEON_AI_GATEWAY_TOKEN: "nt_live_x" })), { baseURL: "https://gw", apiKey: "nt_live_x" });
  });

  it("reads the database name out of a connection string", () => {
    assert.equal(databaseName("postgresql://u:p@ep-x-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"), "neondb");
    assert.equal(databaseName("postgresql://postgres:postgres@localhost:54329/mesquared_os"), "mesquared_os");
    assert.equal(databaseName(undefined), null);
    assert.equal(databaseName("not a url"), null);
  });
});

describe("qualifier engine selection", () => {
  it("prefers the Neon AI Gateway, then a direct key, then rules", () => {
    assert.equal(qualifierEngine({}), "rules");
    assert.equal(qualifierEngine(envWith({ ANTHROPIC_API_KEY: "sk" })), "anthropic");
    assert.equal(qualifierEngine(envWith({ ANTHROPIC_API_KEY: "sk", NEON_AI_GATEWAY_BASE_URL: "https://gw", NEON_AI_GATEWAY_TOKEN: "t" })), "neon-ai-gateway");
  });

  it("honours a pin only when that engine has credentials", () => {
    const both = { ANTHROPIC_API_KEY: "sk", NEON_AI_GATEWAY_BASE_URL: "https://gw", NEON_AI_GATEWAY_TOKEN: "t" };
    assert.equal(qualifierEngine(envWith({ ...both, QUALIFIER_ENGINE: "anthropic" })), "anthropic");
    assert.equal(qualifierEngine(envWith({ ...both, QUALIFIER_ENGINE: "rules" })), "rules");
    assert.equal(qualifierEngine(envWith({ NEON_AI_GATEWAY_BASE_URL: "https://gw", NEON_AI_GATEWAY_TOKEN: "t", QUALIFIER_ENGINE: "anthropic" })), "neon-ai-gateway");
  });

  it("names the gateway route on the classifier so operators can see it, and it still reads as AI", () => {
    const q = createAnthropicQualifier({ apiKey: "nt_live_x", baseURL: "https://gw/anthropic", model: "claude-opus-5-5", via: "neon-ai-gateway" });
    assert.equal(q.name, "anthropic/neon-ai-gateway:claude-opus-5-5");
    assert.ok(q.name.startsWith("anthropic"));
  });
});

describe("object storage keys", () => {
  it("keeps every key under the tenant prefix", () => {
    assert.equal(tenantObjectKey("tenant_a", "content/abc/photo.jpg"), "tenants/tenant_a/content/abc/photo.jpg");
    assert.equal(tenantObjectKey("tenant_a", "../../etc/passwd"), "tenants/tenant_a/etc/passwd");
    assert.equal(tenantObjectKey("tenant_a", "/weird name (1).PNG"), "tenants/tenant_a/weird-name-1-.PNG");
    assert.throws(() => tenantObjectKey("tenant_a", "/"));
    assert.throws(() => tenantObjectKey("../x", "a.txt"));
  });

  it("checks ownership and round-trips the fileUrl form", () => {
    const key = tenantObjectKey("tenant_a", "content/x/y.txt");
    assert.ok(tenantOwnsKey("tenant_a", key));
    assert.equal(tenantOwnsKey("tenant_b", key), false);
    const url = fileUrlFromKey(key);
    assert.equal(url, "neon-storage://assets/tenants/tenant_a/content/x/y.txt");
    assert.equal(storageKeyFromFileUrl(url), key);
    assert.equal(storageKeyFromFileUrl("https://example.com/file.png"), null);
    assert.equal(storageKeyFromFileUrl(null), null);
  });
});

describe("realtime lead queries", () => {
  const lead: LeadRecord = {
    id: "lead_1",
    tenantId: "tenant_a",
    contactId: null,
    pipelineId: null,
    stageId: "stage_1",
    assigneeId: null,
    source: "META_LEAD_FORM",
    externalId: null,
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    phone: null,
    company: null,
    message: "hello",
    attributes: {},
    attribution: {},
    status: "NEW",
    ticketType: "GREEN",
    intentScore: 80,
    qualificationReason: "why",
    qualifiedBy: "stub",
    valueCents: 0,
    respondBy: null,
    bookBy: null,
    firstResponseAt: null,
    bookedAt: null,
    stageEnteredAt: null,
    lastActivityAt: null,
    createdAt: new Date("2026-10-24T00:00:00Z"),
  };

  it("projects a LeadRecord onto exactly the columns the live SQL selects", () => {
    const row = toLiveLeadRow(lead);
    const sql = JSON.stringify(leadsLiveQuery("tenant_a", { onlyAssigneeId: null }));
    for (const column of Object.keys(row)) assert.ok(sql.includes(`\\"${column}\\"`), `live SQL selects ${column}`);
    assert.ok(!("attributes" in row) && !("tenantId" in row), "payload-ish columns stay out of the browser");
  });

  it("scopes by tenant and, for restricted members, by assignee", () => {
    const all = JSON.stringify(leadsLiveQuery("tenant_a", { onlyAssigneeId: null }));
    const mine = JSON.stringify(leadsLiveQuery("tenant_a", { onlyAssigneeId: "user_1" }));
    assert.ok(all.includes('\\"tenantId\\" = $1') && all.includes("tenant_a"));
    assert.ok(mine.includes('\\"assigneeId\\" = $2') && mine.includes("user_1"));
    assert.ok(!all.includes("assigneeId"));
  });
});

describe("neon.ts declares what the app wires", () => {
  const root = resolve(import.meta.dirname, "../..");

  it("declares the assets bucket, the ops function and its minute trigger", () => {
    const config = neonConfig as unknown as { buckets?: Record<string, unknown>; functions?: Record<string, { source: string }>; triggers?: Record<string, { function: string; cron?: string; functionPath?: string }>; aiGateway?: unknown };
    assert.ok(config.buckets?.assets, "bucket `assets` (src/lib/storage.ts relies on it)");
    assert.equal(config.aiGateway, false, "aiGateway off: the qualifier uses ANTHROPIC_API_KEY");
    const ops = config.functions?.ops;
    assert.ok(ops && existsSync(resolve(root, ops.source)), "ops function source exists");
    const tick = config.triggers?.["tick-every-minute"];
    assert.equal(tick?.function, "ops");
    assert.equal(tick?.cron, "* * * * *");
    assert.equal(tick?.functionPath, "/tick");
  });

  it("never uploads a localhost app URL as the tick target", () => {
    // neon.ts is evaluated with the test process env; NEXT_PUBLIC_APP_URL is unset or local here.
    const config = neonConfig as unknown as { functions?: Record<string, { env?: Record<string, string> }> };
    const env = config.functions?.ops?.env;
    assert.ok(!env || !/localhost|127\.0\.0\.1/.test(env.APP_URL ?? ""));
  });
});

afterEach(() => {
  // Nothing here mutates process.env; every helper takes an env object.
});
