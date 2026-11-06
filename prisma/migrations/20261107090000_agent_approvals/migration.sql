-- AlterEnum
ALTER TYPE "AgentRunStatus" ADD VALUE 'PAUSED';

-- AlterTable
ALTER TABLE "AgentToolCall" ADD COLUMN     "editedInput" JSONB;

-- CreateTable
CREATE TABLE "AgentGuidance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "deliveredSeq" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentGuidance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentGuidance_runId_createdAt_idx" ON "AgentGuidance"("runId", "createdAt");

-- AddForeignKey
ALTER TABLE "AgentGuidance" ADD CONSTRAINT "AgentGuidance_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

