-- AlterTable
ALTER TABLE "Outbox" ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "providerMessageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Outbox_providerMessageId_key" ON "Outbox"("providerMessageId");
