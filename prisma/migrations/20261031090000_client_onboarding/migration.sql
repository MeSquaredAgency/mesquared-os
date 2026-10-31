-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('INVITED', 'IN_PROGRESS', 'SUBMITTED', 'PROVISIONED', 'CANCELLED');

-- CreateTable
CREATE TABLE "OnboardingSubmission" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "contactEmail" TEXT,
    "status" "OnboardingStatus" NOT NULL DEFAULT 'INVITED',
    "answers" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "tenantId" TEXT,
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "provisionedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingSubmission_tokenHash_key" ON "OnboardingSubmission"("tokenHash");

-- CreateIndex
CREATE INDEX "OnboardingSubmission_status_updatedAt_idx" ON "OnboardingSubmission"("status", "updatedAt");

