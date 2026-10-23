/**
 * Seeds two fictional tenants with an API key each so /api/v1/intake can be
 * exercised immediately. Run with `npm run db:seed`. Keys are printed once.
 */
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";

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

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PRODUCTION_SEED !== "true") {
    throw new Error("Refusing to seed demo tenants and a platform-admin user in production (set ALLOW_PRODUCTION_SEED=true to override).");
  }
  const tenants = [
    {
      slug: "northwind-clinics",
      name: "Northwind Clinics",
      timezone: "Australia/Sydney",
      locale: "en-AU",
      currency: "AUD",
      branding: { primaryColor: "#0f766e", fromName: "Northwind Clinics" },
      qualificationRules: {
        greenKeywords: ["implant", "consult", "whitening"],
        redKeywords: ["invoice", "supplier"],
        minBudget: 500,
        highIntentServices: ["dental implants", "smile makeover"],
      },
    },
    {
      slug: "harbor-legal",
      name: "Harbor Legal Partners",
      timezone: "America/New_York",
      locale: "en-US",
      currency: "USD",
      branding: { primaryColor: "#1d4ed8", fromName: "Harbor Legal" },
      qualificationRules: {
        greenKeywords: ["retainer", "estate plan", "closing"],
        redKeywords: ["marketing", "sponsorship"],
        minBudget: 2500,
        highIntentServices: ["estate planning", "business formation"],
      },
    },
  ];

  const operatorPassword = process.env.SEED_OPERATOR_PASSWORD || randomBytes(12).toString("base64url");
  const operator = await prisma.user.upsert({
    where: { email: "operator@example.com" },
    update: process.env.SEED_OPERATOR_PASSWORD ? { passwordHash: hashPassword(operatorPassword) } : {},
    create: { email: "operator@example.com", name: "Demo Operator", isPlatformAdmin: true, passwordHash: hashPassword(operatorPassword) },
  });
  console.log(`Operator sign-in: operator@example.com / ${operatorPassword}  (shown once — store it now)`);

  for (const t of tenants) {
    const tenant = await prisma.tenant.upsert({
      where: { slug: t.slug },
      update: { name: t.name, branding: t.branding, qualificationRules: t.qualificationRules },
      create: t,
    });

    await prisma.membership.upsert({
      where: { tenantId_userId: { tenantId: tenant.id, userId: operator.id } },
      update: {},
      create: { tenantId: tenant.id, userId: operator.id, role: "OWNER" },
    });

    const existing = await prisma.tenantApiKey.findFirst({ where: { tenantId: tenant.id, revokedAt: null } });
    if (!existing) {
      const key = makeKey();
      await prisma.tenantApiKey.create({
        data: { tenantId: tenant.id, label: "Seed key", keyHash: key.hash, keyPrefix: key.prefix },
      });
      console.log(`${tenant.name}: API key ${key.raw}  (shown once — store it now)`);
    } else {
      console.log(`${tenant.name}: existing key ${existing.keyPrefix}…`);
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
