/**
 * Proves each Neon service declared in neon.ts works end to end against the
 * linked branch, through the app's own modules (not raw SDK calls), so a pass
 * here means the code paths the app uses are the ones that work.
 *
 *   npm run neon:check                                   # every configured service
 *   npm run neon:check -- --function-url https://…       # also the deployed `ops` Function
 *
 * Reads .env and .env.local (the files `neon deploy` writes). Exits non-zero
 * on any failure; services without credentials are reported as skipped.
 */
import assert from "node:assert/strict";
import { createRealtime, type RealtimeDirectServer, type RawSqlQuery } from "@neon/realtime/server";
import type { MaterializedLiveQuerySubscription } from "@neon/realtime/client";
import { dataMode, repository } from "@/lib/data";
import { processIntake } from "@/lib/intake/process";
import { intakeSchema } from "@/lib/intake/schema";
import { aiGatewayConfig, databaseName, neonServices } from "@/lib/neon";
import { registerPlaybook } from "@/lib/playbook";
import { getPrisma } from "@/lib/prisma";
import { getQualifier, qualifierEngine } from "@/lib/qualify";
import { leadsLiveQuery, type LiveLeadRow } from "@/lib/realtime/server";
import { deleteTenantObject, getTenantObjectUrl, putTenantObject, readTenantObject } from "@/lib/storage";

process.env.MESSAGING_MODE ??= "log";
process.env.DEFAULT_FROM_EMAIL ??= "hello@example.com";
registerPlaybook();

const args = process.argv.slice(2);
const functionFlag = args.indexOf("--function-url");
const functionUrl = (functionFlag >= 0 ? args[functionFlag + 1] : process.env.NEON_OPS_FUNCTION_URL)?.replace(/\/+$/, "");
const services = neonServices();
const stamp = Date.now().toString(36);
let failures = 0;

async function step(service: string, name: string, fn: () => Promise<string | void>) {
  try {
    const detail = await fn();
    console.log(`  ok   [${service}] ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (error) {
    failures++;
    console.log(`  FAIL [${service}] ${name}\n       ${error instanceof Error ? error.message : String(error)}`);
  }
}
const skip = (service: string, reason: string) => console.log(`  skip [${service}] ${reason}`);

console.log(`Neon check (data mode: ${dataMode})`);

// --- Lakebase Postgres via Prisma ---------------------------------------------------------
if (!services.postgres) {
  skip("postgres", "DATABASE_URL is not set");
} else {
  await step("postgres", "pooled connection answers", async () => {
    const [row] = await getPrisma().$queryRaw<{ version: string; db: string }[]>`SELECT version() AS version, current_database() AS db`;
    const host = new URL(process.env.DATABASE_URL as string).hostname;
    return `${row.db} on ${host} (${host.includes("-pooler") ? "pooled" : "direct"}); ${row.version.split(" ").slice(0, 2).join(" ")}`;
  });
  await step("postgres", "direct URL for Prisma Migrate is present and unpooled", async () => {
    assert.ok(process.env.DATABASE_URL_UNPOOLED, "DATABASE_URL_UNPOOLED is not set");
    const host = new URL(process.env.DATABASE_URL_UNPOOLED).hostname;
    assert.ok(!host.includes("-pooler"), "DATABASE_URL_UNPOOLED points at the pooler");
    return host;
  });
  await step("postgres", "schema migrated and tenants seeded", async () => {
    const tenants = await repository.listAllTenants();
    assert.ok(tenants.length > 0, "no tenants: run `npx prisma migrate deploy && npm run db:seed`");
    return `${tenants.length} tenant(s): ${tenants.map((t) => t.slug).join(", ")}`;
  });
}
const tenant = services.postgres ? ((await repository.listAllTenants().catch(() => []))[0] ?? null) : null;

// --- AI Gateway ----------------------------------------------------------------------------
if (!services.aiGateway) {
  skip("ai-gateway", "NEON_AI_GATEWAY_BASE_URL / NEON_AI_GATEWAY_TOKEN are not set");
} else {
  const gateway = aiGatewayConfig() as { baseURL: string; apiKey: string };
  const model = process.env.QUALIFIER_MODEL ?? "claude-opus-5-5";
  await step("ai-gateway", `branch gateway serves ${model}`, async () => {
    const res = await fetch(`${gateway.baseURL}/v1/models`, { headers: { authorization: `Bearer ${gateway.apiKey}` } });
    assert.equal(res.status, 200, `GET /v1/models → HTTP ${res.status}`);
    const body = (await res.json()) as { data: { id: string; enabled: boolean }[] };
    const target = body.data.find((m) => m.id === model);
    assert.ok(target, `${model} is not in this branch's catalog`);
    assert.ok(target.enabled, `${model} is locked for this account (plan or credits)`);
    return `${body.data.filter((m) => m.enabled).length}/${body.data.length} models enabled`;
  });
  await step("ai-gateway", "lead qualifier classifies through the gateway", async () => {
    assert.equal(qualifierEngine(), "neon-ai-gateway");
    const qualifier = await getQualifier();
    const result = await qualifier.qualify(
      {
        source: "META_LEAD_FORM",
        firstName: "Neon",
        lastName: "Check",
        email: `neon-check-${stamp}@example.com`,
        phone: "+61400000000",
        message: "I own two units in Glenelg and want a rental appraisal and a property manager this week.",
        attributes: { timeline: "this week" },
      },
      tenant?.qualificationRules ?? { greenCriteria: ["wants an appraisal or property management"] },
    );
    assert.ok(!/fallback/.test(result.classifier), `fell back to rules: ${result.classifier}`);
    return `${result.classifier} → ${result.ticketType} (${result.intentScore}): ${result.reason.slice(0, 80)}`;
  });
}

// --- Object Storage ------------------------------------------------------------------------
if (!services.objectStorage) {
  skip("object-storage", "AWS_* variables are not set");
} else {
  const tenantId = tenant?.id ?? "neon_check";
  const content = `neon check ${stamp}`;
  let key = "";
  await step("object-storage", "put an object under the tenant prefix", async () => {
    ({ key } = await putTenantObject(tenantId, `checks/${stamp}.txt`, content, "text/plain"));
    return key;
  });
  const uploaded = () => assert.ok(key, "skipped: the upload step failed");
  await step("object-storage", "read it back", async () => {
    uploaded();
    const { bytes, contentType } = await readTenantObject(tenantId, key);
    assert.equal(Buffer.from(bytes).toString("utf8"), content);
    return contentType ?? "";
  });
  await step("object-storage", "presigned URL serves it over plain HTTPS", async () => {
    uploaded();
    const url = await getTenantObjectUrl(tenantId, key, 120);
    const res = await fetch(url);
    assert.equal(res.status, 200, `HTTP ${res.status}`);
    assert.equal(await res.text(), content);
    return new URL(url).host;
  });
  await step("object-storage", "another tenant cannot presign it", async () => {
    uploaded();
    await assert.rejects(getTenantObjectUrl("someone_else", key));
  });
  await step("object-storage", "delete", async () => {
    uploaded();
    await deleteTenantObject(tenantId, key);
    await assert.rejects(readTenantObject(tenantId, key));
  });
}

// --- Realtime ------------------------------------------------------------------------------
if (!services.realtime) {
  skip("realtime", "NEON_REALTIME_URL / NEON_REALTIME_SECRET (and DATABASE_URL) are not set");
} else if (!tenant) {
  skip("realtime", "needs a seeded tenant");
} else {
  const realtime: RealtimeDirectServer<RawSqlQuery<unknown>> = createRealtime({
    secret: process.env.NEON_REALTIME_SECRET as string,
    db: databaseName(process.env.DATABASE_URL) as string,
    url: process.env.NEON_REALTIME_URL as string,
  });
  let subscription: MaterializedLiveQuerySubscription<LiveLeadRow> | null = null;
  await step("realtime", "subscribe to the tenant's live lead list", async () => {
    subscription = await realtime.subscribe(leadsLiveQuery(tenant.id, { onlyAssigneeId: null }));
    await subscription.awaitRows(() => true, 20_000);
    return `${subscription.getSnapshot().data?.length ?? 0} rows, status ${subscription.getSnapshot().status}`;
  });
  await step("realtime", "a lead created through the intake pipeline arrives on the subscription", async () => {
    assert.ok(subscription, "no subscription");
    const body = intakeSchema.parse({
      source: "META_LEAD_FORM",
      externalId: `neon_check_${stamp}`,
      name: "Neon Check",
      email: `neon-check-${stamp}@example.com`,
      phone: `+6140${String(Date.now()).slice(-7)}`,
      message: "Checking that the live lead list updates.",
    });
    const result = await processIntake(tenant, body, { neonCheck: true });
    assert.equal(result.outcome, "created");
    const leadId = result.outcome === "created" ? result.lead.id : "";
    await subscription.awaitRows((rows) => rows.some((row) => row.id === leadId), 20_000);
    return `lead ${leadId} appeared live`;
  });
  (subscription as MaterializedLiveQuerySubscription<LiveLeadRow> | null)?.unsubscribe();
  realtime.close();
}

// --- Functions -----------------------------------------------------------------------------
if (!functionUrl) {
  skip("functions", "pass --function-url <invocation url> (from `neon functions get ops`)");
} else {
  await step("functions", "GET / reports database status from the function", async () => {
    const res = await fetch(functionUrl);
    assert.equal(res.status, 200, `HTTP ${res.status}`);
    const body = (await res.json()) as { service: string; branch: string | null; tickForwarding: boolean; database: Record<string, unknown> };
    assert.equal(body.service, "mesquared-os-ops");
    assert.equal(typeof body.database.activeTenants, "number");
    return `branch ${body.branch}; ${body.database.activeTenants} active tenant(s), ${body.database.dueActions} due action(s); tick forwarding ${body.tickForwarding ? "on" : "off"}`;
  });
  await step("functions", "POST /tick rejects callers that are not the trigger", async () => {
    const res = await fetch(`${functionUrl}/tick`, { method: "POST" });
    assert.equal(res.status, 401, `HTTP ${res.status}`);
  });
}

console.log(failures === 0 ? "\nAll Neon checks passed." : `\n${failures} Neon check(s) FAILED.`);
if (services.postgres) await getPrisma().$disconnect().catch(() => undefined);
process.exit(failures === 0 ? 0 : 1);
