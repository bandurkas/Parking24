-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "cashShiftId" TEXT;

-- CreateTable
CREATE TABLE "CashShift" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "shiftDate" DATE NOT NULL,
    "openedById" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingBalance" INTEGER NOT NULL,
    "openKey" TEXT,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "cashIn" INTEGER,
    "cardIn" INTEGER,
    "cashRefund" INTEGER,
    "collected" INTEGER,
    "expectedCash" INTEGER,
    "actualCash" INTEGER,
    "cashDiff" INTEGER,

    CONSTRAINT "CashShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashCollection" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "takenBy" TEXT NOT NULL,
    "handedBy" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "CashCollection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CashShift_number_key" ON "CashShift"("number");

-- CreateIndex
CREATE UNIQUE INDEX "CashShift_openKey_key" ON "CashShift"("openKey");

-- CreateIndex
CREATE INDEX "CashShift_shiftDate_idx" ON "CashShift"("shiftDate");

-- CreateIndex
CREATE INDEX "CashCollection_shiftId_idx" ON "CashCollection"("shiftId");

-- CreateIndex
CREATE INDEX "Payment_cashShiftId_idx" ON "Payment"("cashShiftId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_cashShiftId_fkey" FOREIGN KEY ("cashShiftId") REFERENCES "CashShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashCollection" ADD CONSTRAINT "CashCollection_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashShift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashCollection" ADD CONSTRAINT "CashCollection_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
