/**
 * Seeds two fictional tenants, each configured by applying an industry
 * template, plus demo users for the console and the portal and one API key
 * per tenant. Run with `npm run db:seed`. Secrets are printed once.
 */
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { Prisma, PrismaClient, type Permission, type StageAdvanceTrigger } from "@prisma/client";

const json = (v: unknown) => v as Prisma.InputJsonValue;
import { TEMPLATE_BY_KEY } from "../src/lib/templates/index.ts";
import { MODULES } from "../src/lib/modules/registry.ts";
import { AUTOMATIONS } from "../src/lib/automations/registry.ts";

const prisma = new PrismaClient();

function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64, { N: 16384 });
  return ["scrypt", 16384, salt.toString("base64url"), derived.toString("base64url")].join("$");
}

function makeKey() {
  const raw = `msq_live_${randomBytes(24).toString("base64url")}`;
  return { raw, hash: createHash("sha256").update(raw).digest("hex"), prefix: raw.slice(0, 15) };
}

interface SeedTenant {
  slug: string;
  name: string;
  templateKey: string;
  region: string;
  timezone: string;
  locale: string;
  currency: string;
  branding: Record<string, unknown>;
  serviceAreas?: string[];
}

const TENANTS: SeedTenant[] = [
  { slug: "harbor-realty", name: "Harbor Realty Group", templateKey: "real_estate", region: "AU", timezone: "Australia/Adelaide", locale: "en-AU", currency: "AUD", branding: { primaryColor: "#0f4c81", fromName: "Harbor Realty" }, serviceAreas: ["Adelaide", "Mount Gambier"] },
  { slug: "summit-fitness", name: "Summit Health & Fitness", templateKey: "health_fitness", region: "AU", timezone: "Australia/Sydney", locale: "en-AU", currency: "AUD", branding: { primaryColor: "#c2410c", fromName: "Summit" } },
];

/** Applies an industry template to a tenant: roles, pipelines, modules, automations, brand. Idempotent. */
async function applyTemplate(tenantId: string, templateKey: string) {
  const template = TEMPLATE_BY_KEY[templateKey];
  if (!template) throw new Error(`Unknown template ${templateKey}`);

  for (const role of template.roles) {
    await prisma.tenantRole.upsert({
      where: { tenantId_name: { tenantId, name: role.name } },
      update: { permissions: role.permissions as Permission[], templateKey: role.key },
      create: { tenantId, name: role.name, templateKey: role.key, permissions: role.permissions as Permission[] },
    });
  }

  for (const p of template.pipelines) {
    const pipeline = await prisma.pipeline.upsert({
      where: { tenantId_key: { tenantId, key: p.key } },
      update: { name: p.name, isDefault: Boolean(p.isDefault) },
      create: { tenantId, key: p.key, name: p.name, isDefault: Boolean(p.isDefault) },
    });
    for (const [order, s] of p.stages.entries()) {
      await prisma.pipelineStage.upsert({
        where: { pipelineId_key: { pipelineId: pipeline.id, key: s.key } },
        update: { name: s.name, order, advanceOn: (s.advanceOn ?? "MANUAL") as StageAdvanceTrigger, isWon: Boolean(s.isWon), isLost: Boolean(s.isLost), quietAfterDays: s.quietAfterDays ?? null },
        create: { tenantId, pipelineId: pipeline.id, key: s.key, name: s.name, order, advanceOn: (s.advanceOn ?? "MANUAL") as StageAdvanceTrigger, isWon: Boolean(s.isWon), isLost: Boolean(s.isLost), quietAfterDays: s.quietAfterDays ?? null },
      });
    }
  }

  const enabledModules = new Map(template.modules.map((m) => [m.key, m.settings ?? {}]));
  for (const m of MODULES) {
    await prisma.tenantModule.upsert({
      where: { tenantId_moduleKey: { tenantId, moduleKey: m.key } },
      update: {},
      create: { tenantId, moduleKey: m.key, enabled: enabledModules.has(m.key), settings: json(enabledModules.get(m.key) ?? {}) },
    });
  }

  const enabledAutomations = new Map(template.automations.map((a) => [a.key, a.settings ?? {}]));
  for (const a of AUTOMATIONS) {
    await prisma.tenantAutomation.upsert({
      where: { tenantId_typeKey: { tenantId, typeKey: a.key } },
      update: {},
      create: { tenantId, typeKey: a.key, enabled: enabledAutomations.has(a.key), settings: json(enabledAutomations.get(a.key) ?? {}) },
    });
  }

  await prisma.brandProfile.upsert({
    where: { tenantId },
    update: {},
    create: { tenantId, voice: template.brand.voice, bannedPhrases: template.brand.bannedPhrases, complianceBlock: json(template.brand.complianceBlock) },
  });
}

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PRODUCTION_SEED !== "true") {
    throw new Error("Refusing to seed demo tenants and a platform-admin user in production (set ALLOW_PRODUCTION_SEED=true to override).");
  }

  const password = process.env.SEED_OPERATOR_PASSWORD || randomBytes(12).toString("base64url");
  const passwordHash = hashPassword(password);

  const admin = await prisma.user.upsert({
    where: { email: "operator@example.com" },
    update: process.env.SEED_OPERATOR_PASSWORD ? { passwordHash } : {},
    create: { email: "operator@example.com", name: "Demo Admin", isOperator: true, isPlatformAdmin: true, passwordHash },
  });
  const ops = await prisma.user.upsert({
    where: { email: "ops@example.com" },
    update: process.env.SEED_OPERATOR_PASSWORD ? { passwordHash } : {},
    create: { email: "ops@example.com", name: "Demo Operator", isOperator: true, passwordHash },
  });
  console.log(`Sign-in for operator@example.com and ops@example.com: ${password}  (shown once — store it now)`);

  for (const t of TENANTS) {
    const template = TEMPLATE_BY_KEY[t.templateKey];
    const tenant = await prisma.tenant.upsert({
      where: { slug: t.slug },
      update: { name: t.name, branding: json(t.branding) },
      create: {
        slug: t.slug,
        name: t.name,
        industry: template.industry,
        templateKey: t.templateKey,
        region: t.region,
        timezone: t.timezone,
        locale: t.locale,
        currency: t.currency,
        branding: json(t.branding),
        qualificationRules: json({ ...template.qualificationRules, ...(t.serviceAreas ? { serviceAreas: t.serviceAreas } : {}) }),
        sla: json(template.sla),
        opportunityValues: json(template.opportunityValues),
      },
    });
    await applyTemplate(tenant.id, t.templateKey);
    await prisma.operatorAssignment.upsert({ where: { tenantId_userId: { tenantId: tenant.id, userId: ops.id } }, update: {}, create: { tenantId: tenant.id, userId: ops.id } });

    const ownerRole = await prisma.tenantRole.findFirst({ where: { tenantId: tenant.id, templateKey: "owner" } });
    if (ownerRole) {
      const ownerEmail = `owner@${t.slug}.example`;
      const owner = await prisma.user.upsert({ where: { email: ownerEmail }, update: {}, create: { email: ownerEmail, name: `${t.name} owner`, passwordHash } });
      await prisma.membership.upsert({ where: { tenantId_userId: { tenantId: tenant.id, userId: owner.id } }, update: { roleId: ownerRole.id }, create: { tenantId: tenant.id, userId: owner.id, roleId: ownerRole.id } });
      console.log(`${t.name}: portal owner ${ownerEmail} (same password)`);
    }

    const existingKey = await prisma.tenantApiKey.findFirst({ where: { tenantId: tenant.id, revokedAt: null } });
    if (!existingKey) {
      const key = makeKey();
      await prisma.tenantApiKey.create({ data: { tenantId: tenant.id, label: "Seed key", keyHash: key.hash, keyPrefix: key.prefix } });
      console.log(`${t.name}: API key ${key.raw}  (shown once — store it now)`);
    }
  }
  void admin;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
