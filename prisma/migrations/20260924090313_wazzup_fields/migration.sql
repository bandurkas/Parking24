-- AlterTable
ALTER TABLE "Interaction" ADD COLUMN     "externalId" TEXT;

-- AlterTable (providerMessageId и его индекс — в 20260924085934_outbox_sender_fields, Ф4ш0)
ALTER TABLE "Outbox" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "failCode" TEXT,
ADD COLUMN     "readAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Interaction_externalId_key" ON "Interaction"("externalId");
