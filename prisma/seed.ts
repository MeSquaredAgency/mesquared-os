/**
 * Seeds two fictional tenants with an API key each so /api/v1/intake can be
 * exercised immediately. Run with `npm run db:seed`. Keys are printed once.
 */
import { createHash, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function makeKey() {
  const raw = `msq_live_${randomBytes(24).toString("base64url")}`;
  return { raw, hash: createHash("sha256").update(raw).digest("hex"), prefix: raw.slice(0, 15) };
}

async function main() {
  const tenants = [
    {
      slug: "northwind-clinics",
      name: "Northwind Clinics",
      timezone: "Australia/Sydney",
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

  const operator = await prisma.user.upsert({
    where: { email: "operator@example.com" },
    update: {},
    create: { email: "operator@example.com", name: "Demo Operator", isPlatformAdmin: true },
  });

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
