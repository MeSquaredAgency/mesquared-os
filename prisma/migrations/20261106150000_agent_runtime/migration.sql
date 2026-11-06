-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'WAITING', 'DONE', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AgentToolCallStatus" AS ENUM ('PENDING', 'AWAITING_APPROVAL', 'APPROVED', 'DONE', 'ERROR', 'PROPOSED', 'REFUSED', 'REJECTED', 'EXPIRED');

-- AlterTable
ALTER TABLE "ExceptionItem" ADD COLUMN     "agentRunId" TEXT,
ADD COLUMN     "agentToolCallId" TEXT;

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roleKey" TEXT NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'QUEUED',
    "trigger" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "autonomy" "AgentAutonomy" NOT NULL,
    "model" TEXT NOT NULL,
    "steps" INTEGER NOT NULL DEFAULT 0,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "costMicros" BIGINT NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextStepAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "summary" TEXT,
    "error" TEXT,
    "leadId" TEXT,
    "contactId" TEXT,
    "missedOpportunityId" TEXT,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMessage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "stopReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentToolCall" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "toolUseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "risk" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "AgentToolCallStatus" NOT NULL,
    "result" JSONB,
    "isError" BOOLEAN NOT NULL DEFAULT false,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentToolCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentRun_status_nextStepAt_idx" ON "AgentRun"("status", "nextStepAt");

-- CreateIndex
CREATE INDEX "AgentRun_tenantId_createdAt_idx" ON "AgentRun"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_tenantId_dedupeKey_key" ON "AgentRun"("tenantId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMessage_runId_seq_key" ON "AgentMessage"("runId", "seq");

-- CreateIndex
CREATE INDEX "AgentToolCall_tenantId_status_idx" ON "AgentToolCall"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AgentToolCall_runId_toolUseId_key" ON "AgentToolCall"("runId", "toolUseId");

-- CreateIndex
CREATE UNIQUE INDEX "ExceptionItem_agentToolCallId_key" ON "ExceptionItem"("agentToolCallId");

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_missedOpportunityId_fkey" FOREIGN KEY ("missedOpportunityId") REFERENCES "MissedOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMessage" ADD CONSTRAINT "AgentMessage_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentToolCall" ADD CONSTRAINT "AgentToolCall_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionItem" ADD CONSTRAINT "ExceptionItem_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionItem" ADD CONSTRAINT "ExceptionItem_agentToolCallId_fkey" FOREIGN KEY ("agentToolCallId") REFERENCES "AgentToolCall"("id") ON DELETE SET NULL ON UPDATE CASCADE;

