-- AlterTable
ALTER TABLE "Interaction" ADD COLUMN     "externalId" TEXT;

-- AlterTable
ALTER TABLE "Outbox" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "failCode" TEXT,
ADD COLUMN     "providerMessageId" TEXT,
ADD COLUMN     "readAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Interaction_externalId_key" ON "Interaction"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Outbox_providerMessageId_key" ON "Outbox"("providerMessageId");

