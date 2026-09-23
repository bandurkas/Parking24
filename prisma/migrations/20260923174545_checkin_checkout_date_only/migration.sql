-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "checkedInDateOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "checkedOutDateOnly" BOOLEAN NOT NULL DEFAULT false;
