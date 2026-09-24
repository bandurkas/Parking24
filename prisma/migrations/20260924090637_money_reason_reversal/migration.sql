-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "rejectClearedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "reason" TEXT,
ADD COLUMN     "reversalOfId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_reversalOfId_key" ON "Payment"("reversalOfId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "Payment"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

