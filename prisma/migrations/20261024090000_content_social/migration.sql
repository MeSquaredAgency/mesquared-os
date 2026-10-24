-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "settings" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "ContentAsset" ADD COLUMN     "scheduledFor" TIMESTAMP(3),
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "channelId" TEXT,
ADD COLUMN     "displayName" TEXT,
ADD COLUMN     "meta" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "platform" "SocialPlatform",
ADD COLUMN     "suggestedReply" TEXT;

-- AlterTable
ALTER TABLE "SocialPost" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TenantApiKey" ADD COLUMN     "scopes" TEXT[] DEFAULT ARRAY['intake']::TEXT[];

-- CreateTable
CREATE TABLE "ChannelMetricSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "followers" INTEGER,
    "reach" INTEGER,
    "impressions" INTEGER,
    "engagements" INTEGER,
    "clicks" INTEGER,
    "posts" INTEGER,
    "raw" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelMetricSnapshot_tenantId_date_idx" ON "ChannelMetricSnapshot"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelMetricSnapshot_channelId_date_key" ON "ChannelMetricSnapshot"("channelId", "date");

-- CreateIndex
CREATE INDEX "ContentAsset_tenantId_parentId_idx" ON "ContentAsset"("tenantId", "parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_tenantId_channel_externalId_key" ON "Conversation"("tenantId", "channel", "externalId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMetricSnapshot" ADD CONSTRAINT "ChannelMetricSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelMetricSnapshot" ADD CONSTRAINT "ChannelMetricSnapshot_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

