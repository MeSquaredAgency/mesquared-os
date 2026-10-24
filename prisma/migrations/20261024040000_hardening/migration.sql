-- AlterEnum
ALTER TYPE "ScheduledActionStatus" ADD VALUE 'RUNNING';

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "to" TEXT;

-- AlterTable
ALTER TABLE "ScheduledAction" ADD COLUMN     "lockedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Integration_provider_externalAccountId_key" ON "Integration"("provider", "externalAccountId");

-- CreateIndex
CREATE INDEX "Message_tenantId_direction_createdAt_idx" ON "Message"("tenantId", "direction", "createdAt");

