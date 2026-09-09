-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "actualDays" INTEGER,
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "recalcDecidedAt" TIMESTAMP(3);
