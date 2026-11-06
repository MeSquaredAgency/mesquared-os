-- Agent foundation: an agent can be the sender of a message, a retried send can
-- be recognised by its idempotency key, and each tenant's agents are configured
-- in TenantAgent (src/lib/agents).

-- AlterEnum
ALTER TYPE "MessageSender" ADD VALUE 'AGENT';

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "idempotencyKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Message_tenantId_idempotencyKey_key" ON "Message"("tenantId", "idempotencyKey");

-- CreateEnum
CREATE TYPE "AgentAutonomy" AS ENUM ('SHADOW', 'SUGGEST', 'SUPERVISED', 'DELEGATED');

-- CreateTable
CREATE TABLE "TenantAgent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roleKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "autonomy" "AgentAutonomy" NOT NULL DEFAULT 'SHADOW',
    "toolPolicy" JSONB NOT NULL DEFAULT '{}',
    "instructions" TEXT NOT NULL DEFAULT '',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "model" TEXT,
    "monthlyBudgetMicros" BIGINT,
    "runTokenCap" INTEGER,
    "schedule" JSONB NOT NULL DEFAULT '{}',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantAgent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantAgent_tenantId_roleKey_key" ON "TenantAgent"("tenantId", "roleKey");

-- AddForeignKey
ALTER TABLE "TenantAgent" ADD CONSTRAINT "TenantAgent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
