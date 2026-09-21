-- CreateEnum
CREATE TYPE "RejectKind" AS ENUM ('NO_SPACE', 'OTHER');

-- CreateEnum
CREATE TYPE "NoticeKind" AS ENUM ('BOOKING_REJECTED', 'CHANNEL_DOWN', 'CASH_MISMATCH', 'SHIFT_OPEN');

-- AlterEnum
ALTER TYPE "BookingStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "rejectKind" "RejectKind",
ADD COLUMN     "rejectReason" TEXT,
ADD COLUMN     "rejectedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AdminNotice" (
    "id" TEXT NOT NULL,
    "kind" "NoticeKind" NOT NULL,
    "bookingId" TEXT,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "readById" TEXT,

    CONSTRAINT "AdminNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminNotice_readAt_createdAt_idx" ON "AdminNotice"("readAt", "createdAt");

-- AddForeignKey
ALTER TABLE "AdminNotice" ADD CONSTRAINT "AdminNotice_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminNotice" ADD CONSTRAINT "AdminNotice_readById_fkey" FOREIGN KEY ("readById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
