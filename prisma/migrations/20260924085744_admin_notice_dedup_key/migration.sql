-- AlterTable
ALTER TABLE "AdminNotice" ADD COLUMN     "dedupKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AdminNotice_dedupKey_key" ON "AdminNotice"("dedupKey");

